// Package analytics sends product events to PostHog. It is a no-op without POSTHOG_KEY,
// so self-hosted instances report nothing unless the operator opts in.
// Never put message bodies, email addresses, tokens or credentials in properties.
package analytics

import (
	"log/slog"

	"github.com/posthog/posthog-go"
)

type Client struct {
	ph  posthog.Client
	log *slog.Logger
}

func New(key, host string, log *slog.Logger) *Client {
	c := &Client{log: log}
	if key == "" {
		return c
	}
	ph, err := posthog.NewWithConfig(key, posthog.Config{Endpoint: host})
	if err != nil {
		log.Warn("posthog disabled", "err", err)
		return c
	}
	c.ph = ph
	return c
}

func (c *Client) Enabled() bool { return c != nil && c.ph != nil }

// Capture records an event for a user, grouped by workspace.
func (c *Client) Capture(distinctID, workspaceID, event string, props map[string]any) {
	if !c.Enabled() {
		return
	}
	p := posthog.NewProperties()
	for k, v := range props {
		p.Set(k, v)
	}
	msg := posthog.Capture{DistinctId: distinctID, Event: event, Properties: p}
	if workspaceID != "" {
		msg.Groups = posthog.NewGroups().Set("workspace", workspaceID)
	}
	if err := c.ph.Enqueue(msg); err != nil {
		c.log.Debug("posthog enqueue", "err", err)
	}
}

// Exception reports a server error without its arguments.
func (c *Client) Exception(distinctID, kind, message string) {
	c.Capture(distinctID, "", "$exception", map[string]any{"$exception_type": kind, "$exception_message": message})
}

func (c *Client) Close() {
	if c.Enabled() {
		_ = c.ph.Close()
	}
}
