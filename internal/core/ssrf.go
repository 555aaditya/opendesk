package core

import (
	"context"
	"net/http"
	"net/netip"
	"time"

	"github.com/opendesk/opendesk/internal/netsafe"
)

// errBlockedAddress means an outbound URL resolves to a non-public address.
var errBlockedAddress = netsafe.ErrBlocked

func isPublicIP(ip netip.Addr) bool { return netsafe.IsPublicIP(ip) }

// outboundGuard decides whether a webhook URL is allowed (netsafe.Guard).
type outboundGuard struct{ dev bool }

func (g outboundGuard) validateURL(ctx context.Context, raw string) (string, error) {
	return netsafe.Guard{Dev: g.dev}.ValidateURL(ctx, raw)
}

// webhookClient is the HTTP client for deliveries: guarded dialer, no proxy, no
// redirects, 10 second budget.
func webhookClient(dev bool) *http.Client { return netsafe.Client(dev, 10*time.Second) }
