// Package kb is the knowledge base: collections and articles for agents, and the public
// help center (published articles only, when settings.help_center_enabled is true).
package kb

import (
	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"

	"github.com/opendesk/opendesk/internal/deps"
)

// Register adds this package's routes.
func Register(d *deps.Deps, api huma.API, r chi.Router) {
	registerCollections(d, api)
	registerArticles(d, api)
	registerPublic(d, api)
}
