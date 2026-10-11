package app

import (
	"strings"
	"testing"

	"github.com/useopendesk/opendesk/internal/config"
)

func TestWebCSPConnectsToOrigins(t *testing.T) {
	csp := webCSP(&config.Config{APIURL: "https://desk.example.com/", GatewayURL: "wss://rt.example.com/socket"})
	var connect string
	for _, d := range strings.Split(csp, "; ") {
		if strings.HasPrefix(d, "connect-src ") {
			connect = d
		}
	}
	for _, want := range []string{"'self'", "https://desk.example.com", "wss://rt.example.com"} {
		if !strings.Contains(connect+" ", " "+want+" ") {
			t.Errorf("connect-src lacks %s: %s", want, connect)
		}
	}
	if strings.Contains(connect, "/socket") {
		t.Errorf("connect-src carries a path, which blocks /socket/websocket: %s", connect)
	}
	if got := cspOrigin("not a url"); got != "" {
		t.Errorf("cspOrigin(junk) = %q", got)
	}
}
