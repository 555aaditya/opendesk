// Package core is the core area. Register wires its HTTP routes, RegisterWorkers its
// River workers, Periodic its scheduled jobs and Background its long-running loops.
package core

import (
	"context"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/riverqueue/river"

	"github.com/opendesk/opendesk/internal/deps"
)

// Register adds this area's routes. Prefer huma operations; use r only for raw HTTP
// (redirects, raw bodies, streaming).
func Register(d *deps.Deps, api huma.API, r chi.Router) {}

// RegisterWorkers adds this area's River workers.
func RegisterWorkers(d *deps.Deps, w *river.Workers) {}

// Periodic returns this area's scheduled jobs.
func Periodic(d *deps.Deps) []*river.PeriodicJob { return nil }

// Background runs until ctx is done, in the worker role only.
func Background(ctx context.Context, d *deps.Deps) {}
