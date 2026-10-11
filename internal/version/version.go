// Package version is set at build time with -ldflags "-X .../version.Version=v1.2.3".
package version

var (
	Version = "dev"
	Commit  = "none"
)
