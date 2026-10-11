package contacts

import (
	"encoding/json"

	"github.com/danielgtaylor/huma/v2"
)

// Nullable is a body field that tells "absent" from "null": Set is true when the key was
// present, and Null when its value was null (clear the field).
type Nullable[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (n *Nullable[T]) UnmarshalJSON(b []byte) error {
	n.Set = true
	if string(b) == "null" {
		n.Null = true
		return nil
	}
	return json.Unmarshal(b, &n.Value)
}

// Schema describes the field as a nullable string.
func (n Nullable[T]) Schema(r huma.Registry) *huma.Schema {
	return &huma.Schema{Type: huma.TypeString, Nullable: true}
}
