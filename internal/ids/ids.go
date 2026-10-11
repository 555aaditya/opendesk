// Package ids generates time-ordered UUIDv7 identifiers.
package ids

import "github.com/google/uuid"

// New returns a UUIDv7.
func New() uuid.UUID { return uuid.Must(uuid.NewV7()) }

// Parse parses a UUID, returning ok=false on malformed input.
func Parse(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	return id, err == nil
}
