package knowledge

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/xml"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/html/charset"

	"github.com/useopendesk/opendesk/internal/netsafe"
)

const (
	userAgent       = "opendeskBot/1.0 (+https://opendesk.sh/bot)"
	pageTimeout     = 10 * time.Second
	maxPageBytes    = 2 << 20
	maxRobotsBytes  = 512 << 10
	maxSitemapBytes = 10 << 20
	maxRedirects    = 3
	maxSitemaps     = 50
	maxSitemapURLs  = 50_000
	maxQueue        = 20_000
	crawlBudget     = 100 * time.Minute
	maxCrawlDelay   = 5 * time.Second
)

var (
	errOffSite   = errors.New("redirected off the site")
	errTooLarge  = errors.New("response too large")
	errNotText   = errors.New("not an HTML or text document")
	errRedirects = errors.New("too many redirects")
	errBlocked   = errors.New("destination refused")
)

// statusError is a non-200 answer.
type statusError int

func (e statusError) Error() string { return "status " + strconv.Itoa(int(e)) }

// gone reports a page that no longer exists (its document is removed).
func gone(err error) bool {
	var se statusError
	return errors.As(err, &se) && (se == http.StatusNotFound || se == http.StatusGone)
}

// crawler fetches one site politely: robots.txt, one request per second per host, a
// 10 s timeout and 2 MB per page, at most 3 redirects, each hop checked by the SSRF guard.
type crawler struct {
	client *http.Client
	// check refuses a URL that is not allowed as an outbound target (netsafe.Guard).
	check    func(ctx context.Context, u *url.URL) error
	delay    time.Duration
	maxDelay time.Duration
	sleep    func(ctx context.Context, d time.Duration) error

	last   map[string]time.Time
	robots map[string]*robots
}

func newCrawler(dev bool) *crawler {
	g := netsafe.Guard{Dev: dev}
	return &crawler{
		client: netsafe.Client(dev, pageTimeout),
		check: func(ctx context.Context, u *url.URL) error {
			if _, err := g.ValidateURL(ctx, u.String()); err != nil {
				return errBlocked
			}
			return nil
		},
		delay: time.Second, maxDelay: maxCrawlDelay, sleep: sleepCtx,
	}
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// crawlSpec is what to crawl.
type crawlSpec struct {
	start    *url.URL
	maxPages int
	include  []string
	exclude  []string
	// skip reports page keys removed through the API.
	skip func(key string) bool
}

// crawledPage is one stored page: URL is its normalized URL (the document key).
type crawledPage struct {
	URL   string
	Title string
	Text  string
}

// crawlResult summarizes a crawl.
type crawlResult struct {
	stored  int
	fetched int
	// failed are pages that could not be fetched this time (their documents are kept).
	failed       []string
	startErr     error
	robotsDenied bool
	stopped      bool
}

// site is the set of hosts of one crawl: the start host and its www twin.
type site struct {
	scheme string
	hosts  map[string]bool
}

func newSite(start *url.URL) site {
	s := site{scheme: start.Scheme, hosts: map[string]bool{start.Host: true}}
	host, port := start.Hostname(), start.Port()
	twin := "www." + host
	if strings.HasPrefix(host, "www.") {
		twin = strings.TrimPrefix(host, "www.")
	}
	if port != "" {
		twin += ":" + port
	}
	if net.ParseIP(host) == nil && strings.Contains(strings.TrimPrefix(host, "www."), ".") {
		s.hosts[twin] = true
	}
	return s
}

// owns reports a URL on the site: one of its hosts, the site's scheme or https.
func (s site) owns(u *url.URL) bool {
	return s.hosts[u.Host] && (u.Scheme == s.scheme || u.Scheme == "https")
}

// trackingParams are dropped from URLs so one page is crawled once.
func trackingParam(k string) bool {
	k = strings.ToLower(k)
	return strings.HasPrefix(k, "utm_") || k == "gclid" || k == "fbclid" || k == "msclkid" || k == "mc_cid" ||
		k == "mc_eid" || k == "_hsenc" || k == "_hsmi" || k == "ref_src"
}

// normalizeURL is the canonical form of a page URL (its document key): lowercase scheme
// and host, no default port, no fragment, no credentials, no tracking parameters,
// sorted query, "/" for an empty path.
func normalizeURL(u *url.URL) (*url.URL, bool) {
	if u == nil {
		return nil, false
	}
	n := *u
	n.Scheme = strings.ToLower(n.Scheme)
	if n.Scheme != "http" && n.Scheme != "https" || n.Host == "" || n.Opaque != "" {
		return nil, false
	}
	n.User = nil
	n.Fragment, n.RawFragment = "", ""
	host := strings.ToLower(n.Hostname())
	port := n.Port()
	if (n.Scheme == "https" && port == "443") || (n.Scheme == "http" && port == "80") {
		port = ""
	}
	n.Host = host
	if port != "" {
		n.Host = host + ":" + port
	}
	if strings.Contains(host, ":") && port == "" {
		n.Host = "[" + host + "]"
	}
	if n.Path == "" {
		n.Path, n.RawPath = "/", ""
	}
	if n.RawQuery != "" {
		q := n.Query()
		for k := range q {
			if trackingParam(k) {
				q.Del(k)
			}
		}
		n.RawQuery = q.Encode()
	}
	n.ForceQuery = false
	return &n, true
}

// skippedExt are file types that are never pages.
var skippedExt = map[string]bool{
	".pdf": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true, ".svg": true, ".ico": true,
	".avif": true, ".bmp": true, ".tif": true, ".tiff": true, ".css": true, ".js": true, ".mjs": true, ".json": true,
	".xml": true, ".rss": true, ".atom": true, ".zip": true, ".gz": true, ".tgz": true, ".rar": true, ".7z": true,
	".tar": true, ".dmg": true, ".exe": true, ".msi": true, ".apk": true, ".mp3": true, ".mp4": true, ".mov": true,
	".avi": true, ".webm": true, ".wav": true, ".ogg": true, ".woff": true, ".woff2": true, ".ttf": true, ".otf": true,
	".eot": true, ".doc": true, ".docx": true, ".xls": true, ".xlsx": true, ".ppt": true, ".pptx": true, ".csv": true,
	".wasm": true, ".iso": true, ".bin": true,
}

// wanted reports whether a page path passes the include and exclude prefixes.
func (sp crawlSpec) wanted(u *url.URL) bool {
	p := u.Path
	if p == "" {
		p = "/"
	}
	if skippedExt[strings.ToLower(path.Ext(p))] {
		return false
	}
	for _, x := range sp.exclude {
		if strings.HasPrefix(p, x) {
			return false
		}
	}
	if len(sp.include) == 0 {
		return true
	}
	for _, x := range sp.include {
		if strings.HasPrefix(p, x) {
			return true
		}
	}
	return false
}

func robotsPath(u *url.URL) string {
	p := u.EscapedPath()
	if p == "" {
		p = "/"
	}
	if u.RawQuery != "" {
		p += "?" + u.RawQuery
	}
	return p
}

// crawl visits the site breadth first, sitemap URLs before discovered links, and calls
// emit for each stored page until maxPages pages are stored. emit returning stop ends
// the crawl.
func (c *crawler) crawl(ctx context.Context, sp crawlSpec, emit func(crawledPage) (bool, error)) (crawlResult, error) {
	ctx, cancel := context.WithTimeout(ctx, crawlBudget)
	defer cancel()
	c.last, c.robots = map[string]time.Time{}, map[string]*robots{}
	var res crawlResult
	start, ok := normalizeURL(sp.start)
	if !ok {
		res.startErr = errBlocked
		return res, nil
	}
	st := newSite(start)
	if sp.skip == nil {
		sp.skip = func(string) bool { return false }
	}
	seen := map[string]bool{start.String(): true}
	queue := []*url.URL{start}
	enqueue := func(raw string) {
		u, err := url.Parse(strings.TrimSpace(raw))
		if err != nil {
			return
		}
		n, ok := normalizeURL(u)
		if !ok || !st.owns(n) || len(queue) >= maxQueue {
			return
		}
		k := n.String()
		if seen[k] || !sp.wanted(n) || sp.skip(k) {
			return
		}
		seen[k] = true
		queue = append(queue, n)
	}

	if err := c.check(ctx, start); err != nil {
		res.startErr = errBlocked
		return res, nil
	}
	rb := c.robotsFor(ctx, start, st)
	if rb.unreachable != nil {
		res.startErr = rb.unreachable
		return res, nil
	}
	if !rb.allowed(robotsPath(start)) {
		res.robotsDenied = true
		return res, nil
	}
	// Sitemaps first: those listed in robots.txt, and /sitemap.xml.
	var roots []*url.URL
	for _, raw := range append(rb.sitemaps, "/sitemap.xml") {
		if u, err := start.Parse(strings.TrimSpace(raw)); err == nil {
			if n, ok := normalizeURL(u); ok && st.owns(n) {
				roots = append(roots, n)
			}
		}
	}
	for _, u := range c.sitemapURLs(ctx, roots, st, maxSitemapURLs) {
		enqueue(u)
	}

	maxFetches := sp.maxPages*3 + 20
	for len(queue) > 0 && res.stored < sp.maxPages && res.fetched < maxFetches {
		if ctx.Err() != nil {
			break
		}
		u := queue[0]
		queue = queue[1:]
		isStart := res.fetched == 0 && u == start
		if !c.robotsFor(ctx, u, st).allowed(robotsPath(u)) {
			continue
		}
		res.fetched++
		f, err := c.get(ctx, u, "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1", maxPageBytes, st.owns, true)
		if err != nil {
			if isStart {
				res.startErr = err
			}
			if !gone(err) {
				res.failed = append(res.failed, u.String())
			}
			continue
		}
		final, ok := normalizeURL(f.url)
		if !ok {
			continue
		}
		key := final.String()
		if key != u.String() {
			if seen[key] && !isStart {
				continue
			}
			seen[key] = true
		}
		var pg page
		switch f.mediaType {
		case "text/plain":
			pg = page{Text: tidy(f.text)}
		default:
			pg = extractHTML(f.text, final)
		}
		if !pg.NoFollow {
			for _, l := range pg.Links {
				enqueue(l)
			}
		}
		if pg.NoIndex || !sp.wanted(final) || sp.skip(key) || strings.TrimSpace(pg.Text) == "" {
			continue
		}
		title := pg.Title
		if title == "" {
			title = pageTitleFromURL(final)
		}
		stop, err := emit(crawledPage{URL: key, Title: title, Text: clipRunes(pg.Text, maxDocChars)})
		if err != nil {
			return res, err
		}
		res.stored++
		if stop {
			res.stopped = true
			break
		}
	}
	return res, nil
}

// pageTitleFromURL names a page without a title: its last path segment, or its host.
func pageTitleFromURL(u *url.URL) string {
	seg := path.Base(strings.TrimSuffix(u.Path, "/"))
	if seg == "" || seg == "." || seg == "/" {
		return u.Hostname()
	}
	if s, err := url.PathUnescape(seg); err == nil {
		seg = s
	}
	return cleanLine(strings.TrimSuffix(seg, path.Ext(seg)))
}

func clipRunes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n]))
}

// robotsFor returns the robots.txt rules of u's host, fetched once per crawl. A missing
// file (4xx) allows everything; an unreachable one (5xx, network) allows nothing.
func (c *crawler) robotsFor(ctx context.Context, u *url.URL, st site) *robots {
	if r, ok := c.robots[u.Host]; ok {
		return r
	}
	ru := &url.URL{Scheme: u.Scheme, Host: u.Host, Path: "/robots.txt"}
	f, err := c.get(ctx, ru, "text/plain,*/*;q=0.1", maxRobotsBytes, st.owns, false)
	var r *robots
	var se statusError
	switch {
	case err == nil:
		r = parseRobots(f.text)
	case errors.As(err, &se) && se >= 400 && se < 500:
		r = allowAllRobots()
	default:
		r = denyAllRobots()
		r.unreachable = err
	}
	c.robots[u.Host] = r
	return r
}

// fetched is a successful response.
type fetched struct {
	url       *url.URL
	mediaType string
	text      string
}

// wait spaces requests to one host by the crawl delay (robots.txt Crawl-delay when
// longer, capped).
func (c *crawler) wait(ctx context.Context, host string) error {
	d := c.delay
	if r, ok := c.robots[host]; ok && r != nil && r.delay > d {
		d = min(r.delay, c.maxDelay)
	}
	if t, ok := c.last[host]; ok {
		if err := c.sleep(ctx, time.Until(t.Add(d))); err != nil {
			return err
		}
	}
	c.last[host] = time.Now()
	return nil
}

// get fetches u following at most 3 redirects, each re-checked by the guard and kept on
// the site. pageOnly refuses anything but HTML and plain text.
func (c *crawler) get(ctx context.Context, u *url.URL, accept string, limit int64, owns func(*url.URL) bool, pageOnly bool) (*fetched, error) {
	cur := u
	for hop := 0; ; hop++ {
		if err := c.check(ctx, cur); err != nil {
			return nil, errBlocked
		}
		if err := c.wait(ctx, cur.Host); err != nil {
			return nil, err
		}
		f, next, err := c.once(ctx, cur, accept, limit, pageOnly)
		if err != nil {
			return nil, err
		}
		if f != nil {
			return f, nil
		}
		if hop >= maxRedirects {
			return nil, errRedirects
		}
		n, ok := normalizeURL(next)
		if !ok || !owns(n) {
			return nil, errOffSite
		}
		cur = n
	}
}

// once makes one request: a response, or the redirect target.
func (c *crawler) once(ctx context.Context, u *url.URL, accept string, limit int64, pageOnly bool) (*fetched, *url.URL, error) {
	rctx, cancel := context.WithTimeout(ctx, pageTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, nil, errBlocked
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", accept)
	res, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther, http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		loc := res.Header.Get("Location")
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
		if loc == "" {
			return nil, nil, statusError(res.StatusCode)
		}
		next, err := u.Parse(loc)
		if err != nil {
			return nil, nil, errOffSite
		}
		return nil, next, nil
	case http.StatusOK:
	default:
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
		return nil, nil, statusError(res.StatusCode)
	}
	if res.ContentLength > limit {
		return nil, nil, errTooLarge
	}
	ct := res.Header.Get("Content-Type")
	mt, _, _ := mime.ParseMediaType(ct)
	mt = strings.ToLower(mt)
	if pageOnly && mt != "" && mt != "text/html" && mt != "application/xhtml+xml" && mt != "text/plain" {
		return nil, nil, errNotText
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, nil, err
	}
	if int64(len(body)) > limit {
		return nil, nil, errTooLarge
	}
	if mt == "" {
		ct = http.DetectContentType(body)
		mt, _, _ = mime.ParseMediaType(ct)
		if pageOnly && mt != "text/html" && mt != "text/plain" {
			return nil, nil, errNotText
		}
	}
	if mt == "application/xhtml+xml" {
		mt = "text/html"
	}
	return &fetched{url: u, mediaType: mt, text: decodeText(body, ct)}, nil, nil
}

// decodeText converts a body to UTF-8 using its declared or sniffed charset.
func decodeText(body []byte, contentType string) string {
	if bytes.HasPrefix(body, []byte{0x1f, 0x8b}) {
		return ""
	}
	r, err := charset.NewReader(bytes.NewReader(body), contentType)
	if err != nil {
		return strings.ToValidUTF8(string(body), "�")
	}
	out, err := io.ReadAll(r)
	if err != nil {
		return strings.ToValidUTF8(string(body), "�")
	}
	return strings.ToValidUTF8(string(out), "�")
}

// sitemapURLs reads sitemaps and sitemap indexes (gzip allowed) and returns page URLs.
func (c *crawler) sitemapURLs(ctx context.Context, roots []*url.URL, st site, limit int) []string {
	var out []string
	seen := map[string]bool{}
	queue := append([]*url.URL(nil), roots...)
	for n := 0; len(queue) > 0 && n < maxSitemaps && len(out) < limit; n++ {
		sm := queue[0]
		queue = queue[1:]
		if seen[sm.String()] {
			n--
			continue
		}
		seen[sm.String()] = true
		f, err := c.getRaw(ctx, sm, st)
		if err != nil {
			continue
		}
		pages, indexes := parseSitemap(f)
		for _, raw := range indexes {
			if u, err := url.Parse(raw); err == nil {
				if nu, ok := normalizeURL(u); ok && st.owns(nu) && !seen[nu.String()] {
					queue = append(queue, nu)
				}
			}
		}
		for _, p := range pages {
			if len(out) == limit {
				break
			}
			out = append(out, p)
		}
	}
	return out
}

// getRaw fetches a sitemap body, decompressing gzip.
func (c *crawler) getRaw(ctx context.Context, u *url.URL, st site) ([]byte, error) {
	cur := u
	for hop := 0; ; hop++ {
		if err := c.check(ctx, cur); err != nil {
			return nil, errBlocked
		}
		if err := c.wait(ctx, cur.Host); err != nil {
			return nil, err
		}
		body, next, err := c.onceRaw(ctx, cur)
		if err != nil {
			return nil, err
		}
		if next == nil {
			if bytes.HasPrefix(body, []byte{0x1f, 0x8b}) {
				zr, err := gzip.NewReader(bytes.NewReader(body))
				if err != nil {
					return nil, err
				}
				defer zr.Close()
				body, err = io.ReadAll(io.LimitReader(zr, maxSitemapBytes+1))
				if err != nil {
					return nil, err
				}
				if len(body) > maxSitemapBytes {
					return nil, errTooLarge
				}
			}
			return body, nil
		}
		if hop >= maxRedirects {
			return nil, errRedirects
		}
		n, ok := normalizeURL(next)
		if !ok || !st.owns(n) {
			return nil, errOffSite
		}
		cur = n
	}
}

func (c *crawler) onceRaw(ctx context.Context, u *url.URL) ([]byte, *url.URL, error) {
	rctx, cancel := context.WithTimeout(ctx, pageTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(rctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, nil, errBlocked
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/xml,text/xml;q=0.9,*/*;q=0.1")
	res, err := c.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode < 400 && res.Header.Get("Location") != "" {
		next, err := u.Parse(res.Header.Get("Location"))
		if err != nil {
			return nil, nil, errOffSite
		}
		return nil, next, nil
	}
	if res.StatusCode != http.StatusOK {
		return nil, nil, statusError(res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxSitemapBytes+1))
	if err != nil {
		return nil, nil, err
	}
	if len(body) > maxSitemapBytes {
		return nil, nil, errTooLarge
	}
	return body, nil, nil
}

// parseSitemap returns the page URLs of a urlset and the sitemap URLs of an index. A
// plain text sitemap lists one URL per line.
func parseSitemap(body []byte) (pages, indexes []string) {
	dec := xml.NewDecoder(bytes.NewReader(body))
	dec.Strict = false
	dec.CharsetReader = charset.NewReaderLabel
	var stack []string
	isXML := false
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			isXML = true
			stack = append(stack, strings.ToLower(t.Name.Local))
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			if len(stack) >= 2 && stack[len(stack)-1] == "loc" {
				loc := strings.TrimSpace(string(t))
				if loc == "" {
					continue
				}
				switch stack[len(stack)-2] {
				case "sitemap":
					indexes = append(indexes, loc)
				case "url":
					pages = append(pages, loc)
				}
			}
		}
	}
	if !isXML {
		for _, line := range strings.Split(string(body), "\n") {
			if l := strings.TrimSpace(line); strings.HasPrefix(l, "http://") || strings.HasPrefix(l, "https://") {
				pages = append(pages, l)
			}
		}
	}
	return pages, indexes
}
