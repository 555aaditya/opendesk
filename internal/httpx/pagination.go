package httpx

import (
	"encoding/base64"
	"encoding/json"
)

// ListParams is embedded in list inputs.
type ListParams struct {
	Limit  int    `query:"limit" minimum:"1" maximum:"100" default:"50" doc:"Page size"`
	Cursor string `query:"cursor" doc:"Opaque cursor from next_cursor"`
}

// Page is the list response body.
type Page[T any] struct {
	Data       []T     `json:"data"`
	NextCursor *string `json:"next_cursor"`
}

// EncodeCursor makes an opaque cursor from any JSON-able position.
func EncodeCursor(v any) string {
	raw, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// DecodeCursor reads a cursor made by EncodeCursor. An empty cursor leaves v untouched.
func DecodeCursor(s string, v any) error {
	if s == "" {
		return nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return BadRequest("invalid cursor")
	}
	if json.Unmarshal(raw, v) != nil {
		return BadRequest("invalid cursor")
	}
	return nil
}

// NewPage trims a limit+1 fetch to limit and sets next_cursor from the last kept row.
func NewPage[T any](rows []T, limit int, cursorOf func(T) any) Page[T] {
	p := Page[T]{Data: rows}
	if p.Data == nil {
		p.Data = []T{}
	}
	if len(rows) > limit {
		p.Data = rows[:limit]
		c := EncodeCursor(cursorOf(rows[limit-1]))
		p.NextCursor = &c
	}
	return p
}
