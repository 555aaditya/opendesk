package contacts

import (
	"encoding/json"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"unicode"

	"github.com/opendesk/opendesk/internal/httpx"
)

// cleanEmail validates and lowercases an address.
func cleanEmail(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return "", nil
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || len(s) > 254 || !strings.Contains(s[strings.LastIndex(s, "@")+1:], ".") {
		return "", httpx.Validation("email is not a valid address")
	}
	return s, nil
}

// cleanText trims a free-text field and refuses control characters.
func cleanText(field, s string, max int, multiline bool) (string, error) {
	s = strings.TrimSpace(s)
	if len([]rune(s)) > max {
		return "", httpx.Validation(field + " is too long")
	}
	for _, r := range s {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\t' || r == '\r')) {
			return "", httpx.Validation(field + " contains characters that are not allowed")
		}
	}
	return s, nil
}

func cleanAvatar(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", nil
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(s) > 2000 {
		return "", httpx.Validation("avatar_url must be an https URL")
	}
	return s, nil
}

func cleanCustom(m map[string]any) (map[string]any, error) {
	if m == nil {
		return map[string]any{}, nil
	}
	raw, _ := json.Marshal(m)
	if len(raw) > 16<<10 {
		return nil, httpx.Validation("custom must be 16 KB or less")
	}
	return m, nil
}

var domainRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

func cleanDomain(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(strings.TrimPrefix(s, "https://"), "http://")
	s = strings.TrimPrefix(strings.TrimRight(s, "/"), "www.")
	if s == "" {
		return "", nil
	}
	if len(s) > 253 || !domainRe.MatchString(s) {
		return "", httpx.Validation("domain must be a domain name like example.com")
	}
	return s, nil
}

func likePrefix(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
}
