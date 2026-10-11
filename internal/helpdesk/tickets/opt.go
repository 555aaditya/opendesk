package tickets

import (
	"encoding/json"
	"reflect"

	"github.com/danielgtaylor/huma/v2"
)

// Opt is a PATCH field that tells "absent" from "null": Set is true when the key was
// sent, Null when it was sent as null.
type Opt[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (o *Opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Null = true
		return nil
	}
	return json.Unmarshal(b, &o.Value)
}

func (o Opt[T]) MarshalJSON() ([]byte, error) {
	if !o.Set || o.Null {
		return []byte("null"), nil
	}
	return json.Marshal(o.Value)
}

// Schema is the schema of T, nullable.
func (o Opt[T]) Schema(r huma.Registry) *huma.Schema {
	s := *r.Schema(reflect.TypeOf((*T)(nil)).Elem(), false, "")
	s.Nullable = true
	return &s
}

// Ptr returns the value, or nil for null or absent.
func (o Opt[T]) Ptr() *T {
	if !o.Set || o.Null {
		return nil
	}
	v := o.Value
	return &v
}
