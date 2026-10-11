package email

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"strings"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
)

// xoauth2 is the SASL XOAUTH2 mechanism Gmail and Outlook use for IMAP with OAuth.
// go-sasl ships OAUTHBEARER, which Outlook does not accept.
type xoauth2 struct{ user, token string }

func (x *xoauth2) Start() (string, []byte, error) {
	return "XOAUTH2", []byte("user=" + x.user + "\x01auth=Bearer " + x.token + "\x01\x01"), nil
}

// Next answers the server's error challenge with an empty response, after which the
// server ends the exchange with a tagged NO.
func (x *xoauth2) Next([]byte) ([]byte, error) { return []byte{}, nil }

// imapSession is one authenticated IMAP connection.
type imapSession struct {
	c    *imapclient.Client
	stop func()
}

func (s *imapSession) Close() {
	if s == nil || s.c == nil {
		return
	}
	_ = s.c.Logout().Wait()
	_ = s.c.Close()
	s.stop()
}

// imapError is a failure with a message that is safe to store and show.
type imapError struct {
	msg  string
	auth bool // credentials or token refused
}

func (e *imapError) Error() string { return e.msg }

// dialIMAP connects with TLS (implicit or STARTTLS, verified, TLS 1.2+) and logs in
// with the mailbox password or an OAuth token.
func (s *service) dialIMAP(ctx context.Context, m *mailboxRow) (*imapSession, error) {
	cfg := m.Config
	host, port, mode := cfg.IMAPHost, cfg.IMAPPort, cfg.IMAPTLS
	if host == "" || port == 0 {
		return nil, &imapError{msg: "The IMAP server is not configured."}
	}
	if mode == TLSNone && !s.guard.allowPrivate {
		return nil, &imapError{msg: "The IMAP connection must use TLS."}
	}
	raw, err := s.guard.dial(ctx, host, port)
	if err != nil {
		return nil, dialError("IMAP", err)
	}
	conn, stop := withDeadline(ctx, raw, sessionTimeout)
	var c *imapclient.Client
	switch mode {
	case TLSNone:
		c = imapclient.New(conn, nil)
	case TLSStart:
		c, err = imapclient.NewStartTLS(conn, &imapclient.Options{TLSConfig: s.guard.tlsConfig(host)})
		if err != nil {
			_ = conn.Close()
			stop()
			return nil, &imapError{msg: "Could not start TLS with the IMAP server: " + tlsReason(err)}
		}
	default:
		tc := tls.Client(conn, s.guard.tlsConfig(host))
		if err := tc.HandshakeContext(ctx); err != nil {
			_ = conn.Close()
			stop()
			return nil, &imapError{msg: "Could not establish TLS with the IMAP server: " + tlsReason(err)}
		}
		c = imapclient.New(tc, nil)
	}
	sess := &imapSession{c: c, stop: stop}
	if err := c.WaitGreeting(); err != nil {
		_ = c.Close()
		stop()
		return nil, &imapError{msg: "The IMAP server did not answer."}
	}
	switch m.InboundKind {
	case KindGoogle, KindMicrosoft:
		token, err := s.accessToken(ctx, m, resIMAP)
		if err != nil {
			_ = c.Close()
			stop()
			if errors.Is(err, errReconnect) {
				return nil, &imapError{msg: err.Error(), auth: true}
			}
			return nil, err
		}
		user := cfg.IMAPUsername
		if user == "" {
			user = cfg.OAuthEmail
		}
		if err := c.Authenticate(&xoauth2{user: user, token: token}); err != nil {
			_ = c.Close()
			stop()
			return nil, imapLoginError(err, true)
		}
	default:
		creds, err := s.openCreds(m)
		if err != nil {
			_ = c.Close()
			stop()
			return nil, err
		}
		if c.Caps().Has(imap.CapLoginDisabled) {
			_ = c.Close()
			stop()
			return nil, &imapError{msg: "The IMAP server does not allow password login on this connection."}
		}
		if err := c.Login(cfg.IMAPUsername, creds.Password).Wait(); err != nil {
			_ = c.Close()
			stop()
			return nil, imapLoginError(err, false)
		}
	}
	return sess, nil
}

func imapLoginError(err error, oauth bool) error {
	var ie *imap.Error
	if errors.As(err, &ie) {
		text := strings.TrimSpace(ie.Text)
		if oauth {
			return &imapError{msg: "The provider refused the mailbox token. Reconnect the mailbox. (" + truncate(text, 160) + ")", auth: true}
		}
		if ie.Code == imap.ResponseCodeAuthenticationFailed || ie.Type == imap.StatusResponseTypeNo {
			return &imapError{msg: "The IMAP server refused the login: " + truncate(text, 200), auth: true}
		}
		return &imapError{msg: "The IMAP server refused the login: " + truncate(text, 200)}
	}
	return &imapError{msg: "The IMAP connection dropped during login."}
}

func dialError(label string, err error) error {
	switch {
	case errors.Is(err, errBlockedAddress):
		return &imapError{msg: "The " + label + " server address is not allowed (it must be a public address)."}
	case isTimeout(err):
		return &imapError{msg: "Timed out connecting to the " + label + " server."}
	}
	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return &imapError{msg: "The " + label + " server host name does not resolve."}
	}
	return &imapError{msg: "Could not connect to the " + label + " server."}
}

func isTimeout(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

func tlsReason(err error) string {
	var cv *tls.CertificateVerificationError
	if errors.As(err, &cv) {
		return "the certificate is not valid for this host"
	}
	var rh tls.RecordHeaderError
	if errors.As(err, &rh) {
		return "the server did not speak TLS on this port"
	}
	if isTimeout(err) {
		return "timed out"
	}
	return "handshake failed"
}

// opError wraps an IMAP command failure with a safe message.
func opError(what string, err error) error {
	var ie *imap.Error
	if errors.As(err, &ie) {
		return &imapError{msg: fmt.Sprintf("The IMAP server refused %s: %s", what, truncate(strings.TrimSpace(ie.Text), 200))}
	}
	if isTimeout(err) {
		return &imapError{msg: "The IMAP server stopped answering during " + what + "."}
	}
	return &imapError{msg: "The IMAP connection dropped during " + what + "."}
}
