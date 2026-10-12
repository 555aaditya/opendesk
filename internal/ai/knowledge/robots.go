package knowledge

import (
	"bufio"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// robotsAgent is the product token robots.txt groups are matched against.
const robotsAgent = "opendeskbot"

// robots is the parsed robots.txt for one host (RFC 9309): the rules of the group for
// opendeskBot, else of the "*" group.
type robots struct {
	rules    []robotsRule
	delay    time.Duration
	sitemaps []string
	denyAll  bool
	// unreachable is why robots.txt could not be read (a server error or no answer).
	unreachable error
}

type robotsRule struct {
	allow   bool
	pattern string
	re      *regexp.Regexp
}

func allowAllRobots() *robots { return &robots{} }
func denyAllRobots() *robots  { return &robots{denyAll: true} }

type robotsGroup struct {
	agents []string
	rules  []robotsRule
	delay  time.Duration
}

func parseRobots(body string) *robots {
	var groups []*robotsGroup
	var cur *robotsGroup
	lastWasAgent := false
	r := &robots{}
	sc := bufio.NewScanner(strings.NewReader(body))
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = line[:i]
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(key))
		val = strings.TrimSpace(val)
		switch key {
		case "user-agent":
			if cur == nil || !lastWasAgent {
				cur = &robotsGroup{}
				groups = append(groups, cur)
			}
			agent := strings.ToLower(val)
			if i := strings.IndexByte(agent, '/'); i >= 0 {
				agent = agent[:i]
			}
			cur.agents = append(cur.agents, strings.TrimSpace(agent))
			lastWasAgent = true
			continue
		case "allow", "disallow":
			if cur != nil && val != "" {
				cur.rules = append(cur.rules, robotsRule{allow: key == "allow", pattern: val, re: robotsPattern(val)})
			}
		case "crawl-delay":
			if cur != nil {
				if f, err := strconv.ParseFloat(val, 64); err == nil && f > 0 {
					cur.delay = time.Duration(f * float64(time.Second))
				}
			}
		case "sitemap":
			if val != "" {
				r.sitemaps = append(r.sitemaps, val)
			}
		}
		lastWasAgent = false
	}
	var specific, star []*robotsGroup
	for _, g := range groups {
		for _, a := range g.agents {
			switch a {
			case robotsAgent:
				specific = append(specific, g)
			case "*":
				star = append(star, g)
			}
		}
	}
	use := specific
	if len(use) == 0 {
		use = star
	}
	for _, g := range use {
		r.rules = append(r.rules, g.rules...)
		r.delay = max(r.delay, g.delay)
	}
	return r
}

// robotsPattern compiles a path pattern: "*" matches any run, a final "$" anchors the end.
func robotsPattern(p string) *regexp.Regexp {
	anchored := strings.HasSuffix(p, "$")
	p = strings.TrimSuffix(p, "$")
	var b strings.Builder
	b.WriteByte('^')
	for i, part := range strings.Split(p, "*") {
		if i > 0 {
			b.WriteString(".*")
		}
		b.WriteString(regexp.QuoteMeta(part))
	}
	if anchored {
		b.WriteByte('$')
	}
	re, err := regexp.Compile(b.String())
	if err != nil {
		return regexp.MustCompile(`^` + regexp.QuoteMeta(p))
	}
	return re
}

// allowed reports whether path (escaped path and query) may be fetched: the longest
// matching rule wins, allow on a tie.
func (r *robots) allowed(path string) bool {
	if r == nil {
		return true
	}
	if path == "/robots.txt" {
		return true
	}
	if r.denyAll {
		return false
	}
	best, allow := -1, true
	for _, rule := range r.rules {
		if !rule.re.MatchString(path) {
			continue
		}
		n := len(rule.pattern)
		if n > best || (n == best && rule.allow) {
			best, allow = n, rule.allow
		}
	}
	return allow
}
