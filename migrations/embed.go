// Package migrations embeds the SQL migrations. Add a new pair as the next
// six-digit version: 000002_name.up.sql and 000002_name.down.sql.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
