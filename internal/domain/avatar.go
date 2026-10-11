package domain

import (
	"encoding/json"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
)

// Avatar is a stored picture reference: "img:<image id>" (a processed image served from
// /v1/images) or "" for none. It marshals as the public URL, or null.
type Avatar string

// AvatarRef is the stored value for an image id.
func AvatarRef(id uuid.UUID) Avatar { return Avatar("img:" + id.String()) }

// ImageID returns the image id the value refers to.
func (a Avatar) ImageID() (uuid.UUID, bool) {
	s, ok := strings.CutPrefix(string(a), "img:")
	if !ok {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(s)
	return id, err == nil
}

// URL is the public URL of the 256 px image, or "".
func (a Avatar) URL() string {
	if id, ok := a.ImageID(); ok {
		return ImageURL(id)
	}
	return ""
}

// ImageURL is the public URL of a processed image.
func ImageURL(id uuid.UUID) string { return apiURL + "/v1/images/" + id.String() }

func (a Avatar) MarshalJSON() ([]byte, error) {
	if u := a.URL(); u != "" {
		return json.Marshal(u)
	}
	return []byte("null"), nil
}

// UnmarshalJSON accepts what MarshalJSON writes (event payloads read back in tests and
// replays): a URL of this API's images, or null.
func (a *Avatar) UnmarshalJSON(b []byte) error {
	var s *string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	*a = ""
	if s != nil {
		if rest, ok := strings.CutPrefix(*s, apiURL+"/v1/images/"); ok {
			if id, err := uuid.Parse(strings.SplitN(rest, "?", 2)[0]); err == nil {
				*a = AvatarRef(id)
			}
		}
	}
	return nil
}

// Schema describes the JSON form: a URL or null.
func (Avatar) Schema(huma.Registry) *huma.Schema {
	return &huma.Schema{Type: huma.TypeString, Nullable: true, Format: "uri",
		Description: "Picture URL (256 px PNG; add ?s=64 for 64 px), or null for none"}
}

// AvatarSources are the values of avatar_source.
var AvatarSources = []string{"upload", "oauth", "gravatar", "domain", "widget"}
