package core

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// errBlockedAddress means an outbound URL resolves to a non-public address.
var errBlockedAddress = errors.New("destination is not a public internet address")

var blockedPrefixes = func() []netip.Prefix {
	var out []netip.Prefix
	for _, s := range []string{
		"0.0.0.0/8",          // this network
		"10.0.0.0/8",         // private
		"100.64.0.0/10",      // carrier-grade NAT
		"127.0.0.0/8",        // loopback
		"169.254.0.0/16",     // link-local, cloud metadata
		"172.16.0.0/12",      // private
		"192.0.0.0/24",       // IETF protocol assignments
		"192.0.2.0/24",       // TEST-NET-1
		"192.88.99.0/24",     // 6to4 relay
		"192.168.0.0/16",     // private
		"198.18.0.0/15",      // benchmarking
		"198.51.100.0/24",    // TEST-NET-2
		"203.0.113.0/24",     // TEST-NET-3
		"224.0.0.0/4",        // multicast
		"240.0.0.0/4",        // reserved, broadcast
		"::/128",             // unspecified
		"::1/128",            // loopback
		"::ffff:0:0/96",      // IPv4-mapped (checked after unmapping too)
		"64:ff9b::/96",       // NAT64
		"64:ff9b:1::/48",     // local NAT64
		"100::/64",           // discard
		"2001::/32",          // Teredo
		"2001:10::/28",       // ORCHID
		"2001:20::/28",       // ORCHIDv2
		"2001:db8::/32",      // documentation
		"2002::/16",          // 6to4
		"fc00::/7",           // unique local
		"fe80::/10",          // link-local
		"fec0::/10",          // site-local
		"ff00::/8",           // multicast
		"fd00:ec2::254/128",  // AWS metadata over IPv6
		"169.254.169.254/32", // metadata (covered by link-local; listed for clarity)
	} {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}()

var blockedHostnames = map[string]bool{
	"localhost": true, "metadata.google.internal": true, "metadata.goog": true,
	"metadata.amazonaws.com": true, "instance-data": true, "instance-data.ec2.internal": true,
}

// isPublicIP reports whether ip is a globally routable unicast address.
func isPublicIP(ip netip.Addr) bool {
	if !ip.IsValid() {
		return false
	}
	ip = ip.Unmap()
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	for _, p := range blockedPrefixes {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func isLoopbackHost(host string) bool {
	h := strings.ToLower(strings.Trim(host, "[]."))
	if h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return true
	}
	ip, err := netip.ParseAddr(h)
	return err == nil && ip.Unmap().IsLoopback()
}

// outboundGuard decides whether a URL or dial target is allowed. Development instances
// additionally allow http and loopback targets so a local receiver can be used.
type outboundGuard struct {
	dev      bool
	resolver *net.Resolver
}

func (g outboundGuard) lookup(ctx context.Context, host string) ([]netip.Addr, error) {
	if ip, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		return []netip.Addr{ip}, nil
	}
	r := g.resolver
	if r == nil {
		r = net.DefaultResolver
	}
	return r.LookupNetIP(ctx, "ip", host)
}

// checkHost resolves host and refuses it when any address is not public.
func (g outboundGuard) checkHost(ctx context.Context, host string) ([]netip.Addr, error) {
	h := strings.ToLower(strings.Trim(host, "[]."))
	if h == "" {
		return nil, errBlockedAddress
	}
	loopOK := g.dev && isLoopbackHost(h)
	if !loopOK && (blockedHostnames[h] || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".internal")) {
		return nil, errBlockedAddress
	}
	ips, err := g.lookup(ctx, h)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errBlockedAddress
	}
	for _, ip := range ips {
		if loopOK && ip.Unmap().IsLoopback() {
			continue
		}
		if !isPublicIP(ip) {
			return nil, errBlockedAddress
		}
	}
	return ips, nil
}

// validateURL checks a webhook URL: https (http only for loopback on development
// instances), no credentials, and a host that resolves only to public addresses.
func (g outboundGuard) validateURL(ctx context.Context, raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if len(raw) > 2000 {
		return "", errors.New("The URL is too long.")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Opaque != "" {
		return "", errors.New("Enter a full URL starting with https://.")
	}
	if u.User != nil {
		return "", errors.New("The URL cannot contain a username or password.")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !(g.dev && isLoopbackHost(u.Hostname())) {
			return "", errors.New("The URL must use https://.")
		}
	default:
		return "", errors.New("The URL must use https://.")
	}
	u.Fragment = ""
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := g.checkHost(ctx, u.Hostname()); err != nil {
		if errors.Is(err, errBlockedAddress) {
			return "", errors.New("The URL must point to a public internet address.")
		}
		return "", errors.New("The URL's host could not be resolved.")
	}
	return u.String(), nil
}

// dialContext re-checks the destination at connect time and dials the address it
// validated, so DNS cannot change between the check and the connection.
func (g outboundGuard) dialContext(d *net.Dialer) func(ctx context.Context, network, addr string) (net.Conn, error) {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := g.checkHost(ctx, host)
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, ip := range ips {
			c, err := d.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return c, nil
			}
			lastErr = err
		}
		return nil, lastErr
	}
}

// webhookClient is the HTTP client for deliveries: guarded dialer, no proxy, no
// redirects, 10 second budget.
func webhookClient(dev bool) *http.Client {
	g := outboundGuard{dev: dev}
	d := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           g.dialContext(d),
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			MaxIdleConnsPerHost:   4,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}
