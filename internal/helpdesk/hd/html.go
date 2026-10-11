// Package hd holds what the helpdesk subpackages share: HTML sanitizing, workspace
// settings, notifications, reference checks, validation of filters and automations,
// and attachment uploads. Every query is scoped by the caller's workspace id.
package hd

import (
	"html"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/microcosm-cc/bluemonday"
)

var (
	uuidAttr = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	// Images load from http(s) or from our own attachment route (relative or absolute).
	imgSrc = regexp.MustCompile(`^(?i:https?://[^\s"'<>]+|/v1/attachments/[0-9a-fA-F-]{36}(\?[^\s"'<>]*)?)$`)

	skipContent = []string{"style", "script", "head", "title", "noscript", "iframe", "object", "embed", "applet", "svg", "math", "template"}

	richPolicy = newRichPolicy()
	textPolicy = bluemonday.StrictPolicy().SkipElementsContent(skipContent...)
	blockBreak = regexp.MustCompile(`(?i)<(br|/p|/div|/tr|/li|/h[1-6]|/blockquote|/pre)\s*/?>`)
	tagPattern = regexp.MustCompile(`(?i)<(!doctype|/?[a-z][a-z0-9]*)(\s|>|/>)`)
)

// newRichPolicy is the allowlist for HTML that agents write (replies, notes, saved
// replies, articles, automation replies). Nothing that can execute survives.
func newRichPolicy() *bluemonday.Policy {
	p := bluemonday.NewPolicy()
	p.SkipElementsContent(skipContent...)
	p.AllowElements("p", "br", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote", "code", "pre", "h1", "h2", "h3", "span")
	p.AllowAttrs("href").OnElements("a")
	p.AllowURLSchemes("http", "https", "mailto")
	p.AllowRelativeURLs(true)
	p.RequireNoFollowOnLinks(true)
	p.RequireNoReferrerOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)
	p.AllowAttrs("src").Matching(imgSrc).OnElements("img")
	p.AllowAttrs("alt").OnElements("img")
	p.AllowAttrs("data-mention").Matching(uuidAttr).OnElements("span", "a")
	return p
}

// SanitizeRich returns agent HTML reduced to the rich-text allowlist.
func SanitizeRich(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	return strings.TrimSpace(richPolicy.Sanitize(raw))
}

// HTMLToText flattens HTML to readable plain text with line structure kept.
func HTMLToText(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	if !tagPattern.MatchString(raw) {
		return compactLines(html.UnescapeString(raw))
	}
	withBreaks := blockBreak.ReplaceAllString(raw, "\n$0")
	return compactLines(html.UnescapeString(textPolicy.Sanitize(withBreaks)))
}

// TextToHTML turns plain text (widget messages) into paragraphs, escaped.
func TextToHTML(text string) string {
	text = strings.ReplaceAll(strings.TrimSpace(text), "\r\n", "\n")
	if text == "" {
		return ""
	}
	var b strings.Builder
	for _, para := range regexp.MustCompile(`\n{2,}`).Split(text, -1) {
		para = strings.TrimSpace(para)
		if para == "" {
			continue
		}
		b.WriteString("<p>")
		b.WriteString(strings.ReplaceAll(html.EscapeString(para), "\n", "<br>"))
		b.WriteString("</p>")
	}
	return b.String()
}

// Excerpt is the first n runes of text on one line, cut at a word when possible.
func Excerpt(text string, n int) string {
	s := strings.Join(strings.Fields(text), " ")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)[:n]
	out := string(r)
	if i := strings.LastIndex(out, " "); i > n/2 {
		out = out[:i]
	}
	return strings.TrimRight(out, " ,.;:") + "…"
}

// Truncate cuts s to n runes.
func Truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func compactLines(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines))
	blank := false
	for _, ln := range lines {
		ln = strings.Join(strings.Fields(ln), " ")
		if ln == "" {
			if !blank && len(out) > 0 {
				out = append(out, "")
			}
			blank = true
			continue
		}
		blank = false
		out = append(out, ln)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}
