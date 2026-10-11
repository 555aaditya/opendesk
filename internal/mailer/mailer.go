// Package mailer sends opendesk's own platform email (verification, password reset,
// invites, agent notifications). Customer replies go through mailboxes, not here.
package mailer

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"html/template"
	"log/slog"
	"mime"
	"net"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	sestypes "github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"

	"github.com/useopendesk/opendesk/internal/crypto"
)

type Mail struct {
	To      string
	Subject string
	HTML    string
	Text    string
}

type Mailer interface {
	Send(ctx context.Context, m Mail) error
}

type Options struct {
	Driver   string // log | smtp | ses
	From     string
	Host     string
	Port     int
	Username string
	Password string
	TLS      string // tls | starttls | none
	Region   string
}

func New(ctx context.Context, o Options, log *slog.Logger) (Mailer, error) {
	if _, err := mail.ParseAddress(o.From); err != nil {
		return nil, fmt.Errorf("MAIL_FROM: %w", err)
	}
	switch o.Driver {
	case "", "log":
		return &logMailer{log: log}, nil
	case "smtp":
		if o.Host == "" {
			return nil, errors.New("SMTP_HOST is required for MAIL_DRIVER=smtp")
		}
		return &smtpMailer{o: o}, nil
	case "ses":
		cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(o.Region))
		if err != nil {
			return nil, err
		}
		return &sesMailer{client: sesv2.NewFromConfig(cfg), from: o.From}, nil
	}
	return nil, fmt.Errorf("unknown MAIL_DRIVER %q", o.Driver)
}

type logMailer struct{ log *slog.Logger }

// Send logs the mail in development. The body is logged because it is the only way to
// click a verification link locally; never use this driver in production.
func (l *logMailer) Send(_ context.Context, m Mail) error {
	l.log.Info("mail (log driver)", "to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}

type sesMailer struct {
	client *sesv2.Client
	from   string
}

func (s *sesMailer) Send(ctx context.Context, m Mail) error {
	_, err := s.client.SendEmail(ctx, &sesv2.SendEmailInput{
		FromEmailAddress: aws.String(s.from),
		Destination:      &sestypes.Destination{ToAddresses: []string{m.To}},
		Content: &sestypes.EmailContent{Simple: &sestypes.Message{
			Subject: &sestypes.Content{Data: aws.String(m.Subject), Charset: aws.String("UTF-8")},
			Body: &sestypes.Body{
				Html: &sestypes.Content{Data: aws.String(m.HTML), Charset: aws.String("UTF-8")},
				Text: &sestypes.Content{Data: aws.String(m.Text), Charset: aws.String("UTF-8")},
			},
		}},
	})
	return err
}

type smtpMailer struct{ o Options }

func (s *smtpMailer) Send(ctx context.Context, m Mail) error {
	from, _ := mail.ParseAddress(s.o.From)
	msg := Build(s.o.From, m)
	addr := net.JoinHostPort(s.o.Host, strconv.Itoa(s.o.Port))
	var c *smtp.Client
	var err error
	switch s.o.TLS {
	case "tls":
		c, err = smtp.DialTLS(addr, &tls.Config{ServerName: s.o.Host, MinVersion: tls.VersionTLS12})
	case "none":
		c, err = smtp.Dial(addr)
	default:
		c, err = smtp.DialStartTLS(addr, &tls.Config{ServerName: s.o.Host, MinVersion: tls.VersionTLS12})
	}
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	defer c.Close()
	if s.o.Username != "" {
		if err := c.Auth(sasl.NewPlainClient("", s.o.Username, s.o.Password)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.SendMail(from.Address, []string{m.To}, strings.NewReader(msg)); err != nil {
		return fmt.Errorf("smtp send: %w", err)
	}
	return c.Quit()
}

// Build renders a multipart/alternative RFC 5322 message.
func Build(from string, m Mail) string {
	boundary := "od-" + crypto.RandomString(24)
	domain := "opendesk.local"
	if a, err := mail.ParseAddress(from); err == nil {
		if _, d, ok := strings.Cut(a.Address, "@"); ok {
			domain = d
		}
	}
	var b strings.Builder
	h := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	h("From", from)
	h("To", m.To)
	h("Subject", mime.QEncoding.Encode("utf-8", m.Subject))
	h("Date", time.Now().UTC().Format(time.RFC1123Z))
	h("Message-ID", "<"+crypto.RandomString(20)+"@"+domain+">")
	h("MIME-Version", "1.0")
	h("Auto-Submitted", "auto-generated")
	h("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	for _, part := range []struct{ ct, body string }{{"text/plain", m.Text}, {"text/html", m.HTML}} {
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: " + part.ct + "; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n")
		b.WriteString(strings.ReplaceAll(part.body, "\n", "\r\n") + "\r\n")
	}
	b.WriteString("--" + boundary + "--\r\n")
	return b.String()
}

// Layout wraps a short message in the monochrome opendesk email template.
// Heading, paragraphs and the button label are escaped; buttonURL must be one we built.
func Layout(heading string, paragraphs []string, buttonLabel, buttonURL, footer string) (html, text string) {
	var b strings.Builder
	_ = layoutTmpl.Execute(&b, map[string]any{"Heading": heading, "Paragraphs": paragraphs,
		"Label": buttonLabel, "URL": template.URL(buttonURL), "Footer": footer})
	var t strings.Builder
	t.WriteString(heading + "\n\n")
	for _, p := range paragraphs {
		t.WriteString(p + "\n\n")
	}
	if buttonURL != "" {
		t.WriteString(buttonLabel + ": " + buttonURL + "\n\n")
	}
	t.WriteString(footer + "\n")
	return b.String(), t.String()
}

var layoutTmpl = template.Must(template.New("layout").Parse(`<!doctype html>
<html><body style="margin:0;background:#F4F4F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0A0A0A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E4E4;border-radius:12px">
<tr><td style="padding:32px 32px 8px"><span style="font-weight:600;font-size:16px;letter-spacing:-0.02em">opendesk</span></td></tr>
<tr><td style="padding:16px 32px 8px"><h1 style="margin:0;font-size:20px;font-weight:600;letter-spacing:-0.02em">{{.Heading}}</h1></td></tr>
{{range .Paragraphs}}<tr><td style="padding:8px 32px;font-size:14px;line-height:1.6;color:#525252">{{.}}</td></tr>{{end}}
{{if .URL}}<tr><td style="padding:16px 32px 8px"><a href="{{.URL}}" style="display:inline-block;background:#0A0A0A;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:8px">{{.Label}}</a></td></tr>{{end}}
<tr><td style="padding:24px 32px 32px;font-size:12px;line-height:1.5;color:#8A8A8A">{{.Footer}}</td></tr>
</table></td></tr></table></body></html>`))
