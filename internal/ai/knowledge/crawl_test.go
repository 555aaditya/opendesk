package knowledge

import (
	"compress/gzip"
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/useopendesk/opendesk/internal/netsafe"
)

const pageTemplate = `<!doctype html><html><head><title>%TITLE%</title>
<script>var tracking = "SCRIPT-TEXT";</script><style>.x{color:red}</style></head>
<body>
<header><a href="/">Acme</a> HEADER-TEXT</header>
<nav><a href="/docs/c">Docs C</a> <a href="/blog/x">Blog</a> <a href="/private/p">Private</a> <a href="/secret-bot">Bot secret</a>
<a href="https://elsewhere.example/page">External</a> <a href="/docs/a#section">Docs A again</a> <a href="/file.pdf">PDF</a>
<a href="/docs/a?utm_source=x">Tracked</a> NAV-TEXT</nav>
<div id="cookie-banner">Accept cookies COOKIE-TEXT</div>
<main>
<h1>%TITLE%</h1>
<p>%BODY%</p>
<ol><li>Step one</li><li>Step two</li></ol>
<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>20</td></tr></table>
<form><input name="q"> FORM-TEXT</form>
</main>
<aside>ASIDE-TEXT</aside>
<footer>FOOTER-TEXT</footer>
</body></html>`

func htmlPage(title, body string) string {
	return strings.NewReplacer("%TITLE%", title, "%BODY%", body).Replace(pageTemplate)
}

// testSite is a small website with robots.txt, a sitemap index and pages.
type testSite struct {
	srv  *httptest.Server
	mu   sync.Mutex
	hits []string
	uas  []string
	at   []time.Time
	// pages maps a path to its HTML; a missing path is a 404.
	pages map[string]string
}

func newTestSite(t *testing.T) *testSite {
	t.Helper()
	ts := &testSite{pages: map[string]string{
		"/":           htmlPage("Home", "Welcome to Acme."),
		"/docs/a":     htmlPage("Docs A", "Resetting your password takes a minute."),
		"/docs/b":     htmlPage("Docs B", "Billing questions are answered here."),
		"/docs/c":     htmlPage("Docs C", "Exporting data to CSV."),
		"/blog/x":     htmlPage("Blog X", "Our company news."),
		"/private/p":  htmlPage("Private", "PRIVATE-TEXT"),
		"/secret-bot": htmlPage("Bot secret", "BOT-SECRET-TEXT"),
	}}
	mux := http.NewServeMux()
	mux.HandleFunc("/robots.txt", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("User-agent: *\nDisallow: /docs/\n\nUser-agent: opendeskBot\nDisallow: /private/\nDisallow: /secret-bot$\nAllow: /\n\nSitemap: /sitemap-index.xml\n"))
	})
	mux.HandleFunc("/sitemap-index.xml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
			<sitemap><loc>` + "http://" + r.Host + `/sitemap-pages.xml.gz</loc></sitemap></sitemapindex>`))
	})
	mux.HandleFunc("/sitemap-pages.xml.gz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		zw := gzip.NewWriter(w)
		_, _ = zw.Write([]byte(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
			<url><loc>http://` + r.Host + `/docs/a</loc></url><url><loc>http://` + r.Host + `/docs/b</loc></url></urlset>`))
		_ = zw.Close()
	})
	mux.HandleFunc("/sitemap.xml", http.NotFound)
	mux.HandleFunc("/old", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/docs/a", http.StatusMovedPermanently)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		ts.mu.Lock()
		body, ok := ts.pages[r.URL.Path]
		ts.mu.Unlock()
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(body))
	})
	ts.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ts.mu.Lock()
		ts.hits = append(ts.hits, r.URL.Path)
		ts.uas = append(ts.uas, r.UserAgent())
		ts.at = append(ts.at, time.Now())
		ts.mu.Unlock()
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(ts.srv.Close)
	return ts
}

func (ts *testSite) hit(path string) bool {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	return slices.Contains(ts.hits, path)
}

func (ts *testSite) set(path, body string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if body == "" {
		delete(ts.pages, path)
	} else {
		ts.pages[path] = body
	}
}

func devCrawler() *crawler {
	c := newCrawler(true)
	c.delay = 0
	return c
}

func runCrawl(t *testing.T, c *crawler, sp crawlSpec) (map[string]crawledPage, crawlResult) {
	t.Helper()
	got := map[string]crawledPage{}
	res, err := c.crawl(context.Background(), sp, func(p crawledPage) (bool, error) {
		got[p.URL] = p
		return false, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return got, res
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestCrawlRobotsSitemapLinksFilters(t *testing.T) {
	ts := newTestSite(t)
	base := ts.srv.URL
	got, res := runCrawl(t, devCrawler(), crawlSpec{start: mustURL(t, base+"/"), maxPages: 50,
		include: []string{"/docs"}, exclude: []string{"/docs/b"}})

	want := []string{base + "/docs/a", base + "/docs/c"}
	var keys []string
	for k := range got {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if !slices.Equal(keys, want) {
		t.Fatalf("pages %v, want %v (result %+v)", keys, want, res)
	}
	// The robots group for opendeskBot applies instead of "*" (which disallows /docs/).
	for _, p := range []string{"/private/p", "/secret-bot", "/blog/x", "/docs/b", "/file.pdf"} {
		if ts.hit(p) {
			t.Errorf("%s was fetched", p)
		}
	}
	if !ts.hit("/sitemap-pages.xml.gz") || !ts.hit("/robots.txt") {
		t.Errorf("robots and sitemaps not read: %v", ts.hits)
	}
	for _, ua := range ts.uas {
		if ua != userAgent {
			t.Fatalf("user agent %q", ua)
		}
	}
	// Sitemap pages come before discovered links.
	ia, ic := slices.Index(ts.hits, "/docs/a"), slices.Index(ts.hits, "/docs/c")
	if ia < 0 || ic < 0 || ia > ic {
		t.Errorf("order %v", ts.hits)
	}
	a := got[base+"/docs/a"]
	if a.Title != "Docs A" {
		t.Errorf("title %q", a.Title)
	}
}

func TestCrawlMaxPages(t *testing.T) {
	ts := newTestSite(t)
	got, res := runCrawl(t, devCrawler(), crawlSpec{start: mustURL(t, ts.srv.URL+"/"), maxPages: 2})
	if len(got) != 2 || res.stored != 2 {
		t.Fatalf("stored %d pages: %v", len(got), got)
	}
}

func TestCrawlExtractionQuality(t *testing.T) {
	ts := newTestSite(t)
	got, _ := runCrawl(t, devCrawler(), crawlSpec{start: mustURL(t, ts.srv.URL+"/docs/a"), maxPages: 1})
	p, ok := got[ts.srv.URL+"/docs/a"]
	if !ok {
		t.Fatalf("pages %v", got)
	}
	for _, want := range []string{"Docs A", "Resetting your password takes a minute.", "1. Step one", "2. Step two", "Plan | Price", "Pro | 20"} {
		if !strings.Contains(p.Text, want) {
			t.Errorf("text lacks %q:\n%s", want, p.Text)
		}
	}
	for _, bad := range []string{"SCRIPT-TEXT", "HEADER-TEXT", "NAV-TEXT", "COOKIE-TEXT", "FORM-TEXT", "ASIDE-TEXT", "FOOTER-TEXT", "color:red"} {
		if strings.Contains(p.Text, bad) {
			t.Errorf("text has %q:\n%s", bad, p.Text)
		}
	}
}

func TestCrawlRateLimitPerHost(t *testing.T) {
	ts := newTestSite(t)
	c := newCrawler(true)
	c.delay = 40 * time.Millisecond
	runCrawl(t, c, crawlSpec{start: mustURL(t, ts.srv.URL+"/"), maxPages: 4})
	ts.mu.Lock()
	defer ts.mu.Unlock()
	if len(ts.at) < 4 {
		t.Fatalf("only %d requests", len(ts.at))
	}
	for i := 1; i < len(ts.at); i++ {
		if gap := ts.at[i].Sub(ts.at[i-1]); gap < 35*time.Millisecond {
			t.Fatalf("requests %d and %d only %v apart", i-1, i, gap)
		}
	}
}

func TestCrawlFollowsRedirectOnSite(t *testing.T) {
	ts := newTestSite(t)
	got, _ := runCrawl(t, devCrawler(), crawlSpec{start: mustURL(t, ts.srv.URL+"/old"), maxPages: 1})
	if _, ok := got[ts.srv.URL+"/docs/a"]; !ok {
		t.Fatalf("redirect target not stored: %v", got)
	}
}

// TestCrawlRefusesPrivateRedirects runs a production crawler against a site that the
// test treats as public ("site.test"); its redirects to loopback and private addresses
// are refused by the SSRF guard.
func TestCrawlRefusesPrivateRedirects(t *testing.T) {
	var mu sync.Mutex
	secretHit := false
	secret := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		secretHit = true
		mu.Unlock()
		_, _ = w.Write([]byte("<html><body><main><p>INTERNAL-SECRET</p></main></body></html>"))
	}))
	defer secret.Close()
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/robots.txt", "/sitemap.xml":
			http.NotFound(w, r)
		case "/":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<html><body><main><p>Home page text.</p><a href="/to-loopback">a</a><a href="/to-private">b</a><a href="/to-metadata">c</a></main></body></html>`))
		case "/to-loopback":
			http.Redirect(w, r, secret.URL+"/x", http.StatusFound)
		case "/to-private":
			http.Redirect(w, r, "https://10.1.2.3/x", http.StatusFound)
		case "/to-metadata":
			http.Redirect(w, r, "http://169.254.169.254/latest/meta-data/", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer site.Close()

	guard := netsafe.Guard{Dev: false}
	c := newCrawler(false)
	c.delay = 0
	siteAddr := site.Listener.Addr().String()
	c.client = &http.Client{
		Transport: &http.Transport{DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			// Every host resolves to the test site, so a refused hop is the guard's doing.
			return (&net.Dialer{}).DialContext(ctx, network, siteAddr)
		}},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	c.check = func(ctx context.Context, u *url.URL) error {
		if u.Hostname() == "site.test" {
			return nil
		}
		if _, err := guard.ValidateURL(ctx, u.String()); err != nil {
			return errBlocked
		}
		return nil
	}
	got, _ := runCrawl(t, c, crawlSpec{start: mustURL(t, "http://site.test/"), maxPages: 10})
	if len(got) != 1 {
		t.Fatalf("pages %v", got)
	}
	for _, p := range got {
		if strings.Contains(p.Text, "INTERNAL-SECRET") {
			t.Fatal("followed a redirect to a private address")
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if secretHit {
		t.Fatal("the loopback server was contacted")
	}
}

func TestCrawlProductionRefusesLoopbackStart(t *testing.T) {
	ts := newTestSite(t)
	c := newCrawler(false)
	c.delay = 0
	got, res := runCrawl(t, c, crawlSpec{start: mustURL(t, ts.srv.URL+"/"), maxPages: 5})
	if len(got) != 0 || len(ts.hits) != 0 {
		t.Fatalf("crawled a loopback site in production: %v %v", got, ts.hits)
	}
	if !res.robotsDenied && res.startErr == nil {
		t.Fatalf("result %+v", res)
	}
}

func TestCrawlTooManyRedirectsAndLargePages(t *testing.T) {
	big := strings.Repeat("a", maxPageBytes+10)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			_, _ = w.Write([]byte(`<html><body><main><p>Start text here.</p><a href="/r1">loop</a><a href="/big">big</a><a href="/img">img</a></main></body></html>`))
		case "/r1", "/r2", "/r3", "/r4":
			n := r.URL.Path[2] - '0'
			http.Redirect(w, r, "/r"+string(rune('0'+n+1)), http.StatusFound)
		case "/r5":
			_, _ = w.Write([]byte(`<html><body><p>Too far.</p></body></html>`))
		case "/big":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte("<html><body><p>" + big + "</p></body></html>"))
		case "/img":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("\x89PNG...."))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	got, _ := runCrawl(t, devCrawler(), crawlSpec{start: mustURL(t, srv.URL+"/"), maxPages: 10})
	if len(got) != 1 {
		t.Fatalf("pages %v", got)
	}
}

func TestRobots(t *testing.T) {
	r := parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /*.json$\nCrawl-delay: 2\nSitemap: https://x.test/s.xml\n")
	cases := map[string]bool{"/": true, "/admin": false, "/admin/x": false, "/admin/public/a": true, "/a.json": false, "/a.json?x=1": true, "/robots.txt": true}
	for p, want := range cases {
		if got := r.allowed(p); got != want {
			t.Errorf("allowed(%q) = %v, want %v", p, got, want)
		}
	}
	if r.delay != 2*time.Second || len(r.sitemaps) != 1 {
		t.Errorf("delay %v sitemaps %v", r.delay, r.sitemaps)
	}
	specific := parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: opendeskBot/1.0\nUser-agent: other\nDisallow: /no\n")
	if !specific.allowed("/yes") || specific.allowed("/no/x") {
		t.Error("opendeskBot group not used")
	}
	if denyAllRobots().allowed("/x") || !allowAllRobots().allowed("/x") {
		t.Error("deny/allow all")
	}
}

func TestNormalizeURL(t *testing.T) {
	cases := map[string]string{
		"HTTPS://Example.COM:443":                "https://example.com/",
		"https://example.com/a#frag":             "https://example.com/a",
		"https://u:p@example.com/a?utm_source=x": "https://example.com/a",
		"https://example.com/a?b=2&a=1":          "https://example.com/a?a=1&b=2",
		"http://example.com:8080/x":              "http://example.com:8080/x",
	}
	for in, want := range cases {
		u, _ := url.Parse(in)
		n, ok := normalizeURL(u)
		if !ok || n.String() != want {
			t.Errorf("normalize(%q) = %v, want %q", in, n, want)
		}
	}
	for _, bad := range []string{"mailto:a@b.c", "javascript:alert(1)", "ftp://x.test/"} {
		u, _ := url.Parse(bad)
		if _, ok := normalizeURL(u); ok {
			t.Errorf("normalize(%q) accepted", bad)
		}
	}
	st := newSite(mustURL(t, "https://acme.test/"))
	if !st.owns(mustURL(t, "https://www.acme.test/x")) || st.owns(mustURL(t, "https://evil.test/")) || st.owns(mustURL(t, "https://docs.acme.test/")) {
		t.Error("site hosts")
	}
}

func TestParseSitemapText(t *testing.T) {
	pages, idx := parseSitemap([]byte("https://a.test/1\nnot a url\nhttps://a.test/2\n"))
	if len(pages) != 2 || len(idx) != 0 {
		t.Fatalf("%v %v", pages, idx)
	}
}
