package images

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// GravatarURL is the lookup URL for an email: sha256 of the trimmed, lowercased
// address, d=404 so a miss is a 404 rather than a generated picture.
func (f *Fetcher) GravatarURL(email string) string {
	base := f.GravatarBase
	if base == "" {
		base = "https://gravatar.com/avatar/"
	}
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return base + hex.EncodeToString(sum[:]) + "?d=404&s=256&r=g"
}

// Gravatar fetches a contact's Gravatar picture. ErrNotFound when there is none.
func (f *Fetcher) Gravatar(ctx context.Context, email string) (Processed, error) {
	if !strings.Contains(email, "@") {
		return Processed{}, ErrNotFound
	}
	return f.Image(ctx, f.GravatarURL(email), Cover)
}

var domainRe = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

// ValidDomain reports a plausible public DNS name (no ports, paths or IP literals).
func ValidDomain(d string) bool { return len(d) <= 253 && domainRe.MatchString(d) }

// DomainLogo finds a company's logo: the logo provider when configured, then the
// site's own icons (apple-touch-icon, manifest icons, rel=icon, /favicon.ico PNG
// entries), largest first. ErrNotFound when nothing usable exists.
func (f *Fetcher) DomainLogo(ctx context.Context, domain string) (Processed, error) {
	domain = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(domain, "www.")))
	if !ValidDomain(domain) {
		return Processed{}, ErrNotFound
	}
	if f.LogoURL != nil {
		if p, err := f.image(ctx, f.LogoURL(domain), Contain, nil, minIconSide); err == nil {
			return p, nil
		} else if ctx.Err() != nil {
			return Processed{}, err
		}
	}
	base := "https://" + domain + "/"
	if f.SiteBase != nil {
		base = f.SiteBase(domain)
	}
	var cands []iconCandidate
	if b, _, final, err := f.get(ctx, base, maxHTMLBytes, []string{"text/html", "application/xhtml+xml"}, nil); err == nil {
		cands = parseIcons(b, final)
		for _, m := range manifestLinks(b, final) {
			if mb, _, mu, err := f.get(ctx, m, maxJSONBytes, []string{"application/manifest+json", "application/json", "text/plain", "application/octet-stream"}, nil); err == nil {
				cands = append(cands, parseManifest(mb, mu)...)
			}
			break
		}
	} else if ctx.Err() != nil {
		return Processed{}, err
	}
	root, _ := url.Parse(base)
	if root != nil {
		cands = append(cands,
			iconCandidate{URL: root.ResolveReference(&url.URL{Path: "/apple-touch-icon.png"}).String(), Size: 180, Rank: 3},
			iconCandidate{URL: root.ResolveReference(&url.URL{Path: "/favicon.ico"}).String(), Size: 32, Rank: 4})
	}
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].Rank != cands[j].Rank {
			return cands[i].Rank < cands[j].Rank
		}
		return cands[i].Size > cands[j].Size
	})
	seen := map[string]bool{}
	tries := 0
	for _, c := range cands {
		if seen[c.URL] || tries >= 5 {
			continue
		}
		seen[c.URL] = true
		tries++
		p, err := f.image(ctx, c.URL, Contain, nil, minIconSide)
		if err == nil {
			return p, nil
		}
		if ctx.Err() != nil {
			return Processed{}, ctx.Err()
		}
	}
	return Processed{}, ErrNotFound
}

type iconCandidate struct {
	URL  string
	Size int // declared size, 0 unknown
	Rank int // 0 apple-touch-icon, 1 manifest, 2 icon, 3/4 well-known paths
}

func attr(n *html.Node, k string) string {
	for _, a := range n.Attr {
		if strings.EqualFold(a.Key, k) {
			return a.Val
		}
	}
	return ""
}

// declaredSize reads "180x180" or "16x16 32x32" and returns the largest side; svg and
// "any" sizes are skipped by the caller through the type check.
func declaredSize(s string) int {
	best := 0
	for _, part := range strings.Fields(strings.ToLower(s)) {
		w, _, ok := strings.Cut(part, "x")
		if !ok {
			continue
		}
		if n, err := strconv.Atoi(w); err == nil && n > best {
			best = n
		}
	}
	return best
}

func resolve(base *url.URL, href string) string {
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(strings.ToLower(href), "data:") || base == nil {
		return ""
	}
	u, err := base.Parse(href)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return ""
	}
	return u.String()
}

func walk(n *html.Node, fn func(*html.Node)) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			fn(c)
		}
		walk(c, fn)
	}
}

func links(b []byte) []*html.Node {
	doc, err := html.Parse(bytes.NewReader(b))
	if err != nil {
		return nil
	}
	var out []*html.Node
	walk(doc, func(n *html.Node) {
		if n.Data == "link" && len(out) < 100 {
			out = append(out, n)
		}
	})
	return out
}

func parseIcons(b []byte, base *url.URL) []iconCandidate {
	var out []iconCandidate
	for _, n := range links(b) {
		rel := strings.ToLower(attr(n, "rel"))
		typ := strings.ToLower(attr(n, "type"))
		href := resolve(base, attr(n, "href"))
		if href == "" || strings.Contains(typ, "svg") || strings.HasSuffix(strings.ToLower(strings.SplitN(href, "?", 2)[0]), ".svg") {
			continue
		}
		size := declaredSize(attr(n, "sizes"))
		switch {
		case strings.Contains(rel, "apple-touch-icon"):
			if size == 0 {
				size = 180
			}
			out = append(out, iconCandidate{URL: href, Size: size, Rank: 0})
		case slicesHas(strings.Fields(rel), "icon"):
			out = append(out, iconCandidate{URL: href, Size: size, Rank: 2})
		}
	}
	return out
}

func slicesHas(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

func manifestLinks(b []byte, base *url.URL) []string {
	var out []string
	for _, n := range links(b) {
		if slicesHas(strings.Fields(strings.ToLower(attr(n, "rel"))), "manifest") {
			if h := resolve(base, attr(n, "href")); h != "" {
				out = append(out, h)
			}
		}
	}
	return out
}

func parseManifest(b []byte, base *url.URL) []iconCandidate {
	var m struct {
		Icons []struct {
			Src   string `json:"src"`
			Sizes string `json:"sizes"`
			Type  string `json:"type"`
		} `json:"icons"`
	}
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	var out []iconCandidate
	for i, ic := range m.Icons {
		if i >= 30 || strings.Contains(strings.ToLower(ic.Type), "svg") {
			continue
		}
		if h := resolve(base, ic.Src); h != "" {
			out = append(out, iconCandidate{URL: h, Size: declaredSize(ic.Sizes), Rank: 1})
		}
	}
	return out
}

// IsMiss reports a result to remember as "no picture" rather than a failure to retry soon.
func IsMiss(err error) bool {
	return errors.Is(err, ErrNotFound) || errors.Is(err, ErrUnsupported) || errors.Is(err, ErrDimensions) || errors.Is(err, ErrTooLarge)
}
