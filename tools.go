//go:build tools

// Package tools pins dependencies used across areas so go.mod stays stable while
// areas are developed in parallel. It is never compiled.
package tools

import (
	_ "github.com/coreos/go-oidc/v3/oidc"
	_ "github.com/emersion/go-imap/v2/imapclient"
	_ "github.com/emersion/go-message/mail"
	_ "github.com/emersion/go-msgauth/dkim"
	_ "github.com/emersion/go-sasl"
	_ "github.com/emersion/go-smtp"
	_ "github.com/jhillyerd/enmime/v2"
	_ "github.com/microcosm-cc/bluemonday"
	_ "github.com/pquerna/otp/totp"
	_ "golang.org/x/net/html"
	_ "golang.org/x/oauth2"
	_ "golang.org/x/oauth2/github"
	_ "golang.org/x/oauth2/google"
	_ "golang.org/x/oauth2/microsoft"
	_ "golang.org/x/sync/errgroup"
	_ "golang.org/x/text/unicode/norm"
)
