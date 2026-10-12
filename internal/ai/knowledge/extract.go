package knowledge

import (
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// page is the readable content of one HTML document.
type page struct {
	Title    string
	Text     string
	Links    []string // absolute URLs, as found
	NoIndex  bool     // <meta name="robots" content="noindex">
	NoFollow bool     // <meta name="robots" content="nofollow">
}

// droppedTags never carry the page's main text.
var droppedTags = map[atom.Atom]bool{
	atom.Script: true, atom.Style: true, atom.Noscript: true, atom.Template: true, atom.Svg: true, atom.Math: true,
	atom.Canvas: true, atom.Iframe: true, atom.Object: true, atom.Embed: true, atom.Nav: true, atom.Aside: true,
	atom.Form: true, atom.Button: true, atom.Select: true, atom.Input: true, atom.Textarea: true, atom.Dialog: true,
	atom.Head: true, atom.Link: true, atom.Meta: true, atom.Audio: true, atom.Video: true, atom.Picture: true, atom.Img: true,
}

// droppedRoles are ARIA landmarks around the main content.
var droppedRoles = map[string]bool{
	"navigation": true, "banner": true, "contentinfo": true, "complementary": true, "search": true,
	"dialog": true, "alertdialog": true, "menu": true, "menubar": true, "toolbar": true,
}

// boilerplate matches ids and classes of cookie banners, consent dialogs, popups and
// similar chrome.
var boilerplate = regexp.MustCompile(`(?:^|[\s_-])(?:cookies?|cookie-?banner|cookie-?notice|cookie-?consent|consent|gdpr|onetrust|cookielaw|cc-window|cc-banner|newsletter|popup|modal|breadcrumbs?|sidebar|skip-?link|skip-?to-?content|social-?share|share-?buttons|advert|ad-?slot|toc-?sidebar)(?:$|[\s_-])`)

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Namespace == "" && strings.EqualFold(a.Key, key) {
			return a.Val
		}
	}
	return ""
}

func hasAttr(n *html.Node, key string) bool {
	for _, a := range n.Attr {
		if a.Namespace == "" && strings.EqualFold(a.Key, key) {
			return true
		}
	}
	return false
}

// extractHTML parses an HTML document: its title, its main text (headings, paragraphs,
// lists and tables as text; scripts, styles, navigation, headers, footers, asides,
// forms and cookie banners dropped) and its links resolved against base.
func extractHTML(src string, base *url.URL) page {
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return page{}
	}
	var p page
	var body, main, h1 *html.Node
	var articles []*html.Node
	ogTitle := ""
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.DataAtom {
			case atom.Title:
				if p.Title == "" && n.FirstChild != nil {
					p.Title = nodeText(n)
				}
			case atom.Base:
				if h := attr(n, "href"); h != "" && base != nil {
					if b, err := base.Parse(h); err == nil {
						base = b
					}
				}
			case atom.Meta:
				name := strings.ToLower(attr(n, "name"))
				content := strings.ToLower(attr(n, "content"))
				if name == "robots" || name == "opendeskbot" {
					p.NoIndex = p.NoIndex || strings.Contains(content, "noindex") || strings.Contains(content, "none")
					p.NoFollow = p.NoFollow || strings.Contains(content, "nofollow") || strings.Contains(content, "none")
				}
				if strings.EqualFold(attr(n, "property"), "og:title") && ogTitle == "" {
					ogTitle = attr(n, "content")
				}
			case atom.A, atom.Area:
				if h := strings.TrimSpace(attr(n, "href")); h != "" && base != nil {
					if u, err := base.Parse(h); err == nil {
						p.Links = append(p.Links, u.String())
					}
				}
			case atom.Body:
				if body == nil {
					body = n
				}
			case atom.Main:
				if main == nil && !hidden(n) {
					main = n
				}
			case atom.Article:
				articles = append(articles, n)
			case atom.H1:
				if h1 == nil {
					h1 = n
				}
			}
			if main == nil && strings.EqualFold(attr(n, "role"), "main") && !hidden(n) {
				main = n
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)

	p.Title = cleanLine(p.Title)
	if p.Title == "" {
		p.Title = cleanLine(ogTitle)
	}
	if p.Title == "" && h1 != nil {
		p.Title = cleanLine(nodeText(h1))
	}
	if body == nil {
		body = doc
	}
	root := main
	if root == nil && len(articles) == 1 {
		root = articles[0]
	}
	if root == nil {
		p.Text = renderText(body)
		return p
	}
	p.Text = renderText(root)
	// A main landmark that holds a small part of the page's text is a misuse (a hero, a
	// widget); the page body is the better reading.
	if n := utf8.RuneCountInString(p.Text); n < 200 {
		if all := renderText(body); utf8.RuneCountInString(all) > 4*n+500 {
			p.Text = all
		}
	}
	return p
}

// hidden reports an element not shown to readers.
func hidden(n *html.Node) bool {
	if hasAttr(n, "hidden") || strings.EqualFold(attr(n, "aria-hidden"), "true") {
		return true
	}
	st := strings.ToLower(strings.ReplaceAll(attr(n, "style"), " ", ""))
	return strings.Contains(st, "display:none") || strings.Contains(st, "visibility:hidden")
}

// dropped reports elements outside the main text. Headers and footers are kept inside
// an article or main element, where they hold the article's own heading or notes.
func dropped(n *html.Node, inContent bool) bool {
	if droppedTags[n.DataAtom] {
		return true
	}
	if (n.DataAtom == atom.Header || n.DataAtom == atom.Footer) && !inContent {
		return true
	}
	if droppedRoles[strings.ToLower(attr(n, "role"))] || hidden(n) {
		return true
	}
	if n.DataAtom == atom.Body || n.DataAtom == atom.Main || n.DataAtom == atom.Article {
		return false
	}
	idClass := strings.ToLower(attr(n, "id") + " " + attr(n, "class"))
	return strings.TrimSpace(idClass) != "" && boilerplate.MatchString(idClass)
}

// blockBreaks is the separation a block element gets: 2 = paragraph, 1 = line.
var blockBreaks = map[atom.Atom]int{
	atom.P: 2, atom.H1: 2, atom.H2: 2, atom.H3: 2, atom.H4: 2, atom.H5: 2, atom.H6: 2, atom.Blockquote: 2,
	atom.Pre: 2, atom.Table: 2, atom.Ul: 2, atom.Ol: 2, atom.Dl: 2, atom.Section: 2, atom.Article: 2, atom.Figure: 2,
	atom.Header: 2, atom.Footer: 2, atom.Main: 2, atom.Hr: 2, atom.Details: 2, atom.Address: 2,
	atom.Div: 1, atom.Li: 1, atom.Tr: 1, atom.Dt: 1, atom.Dd: 1, atom.Figcaption: 1, atom.Summary: 1, atom.Caption: 1,
	atom.Thead: 1, atom.Tbody: 1, atom.Tfoot: 1,
}

// textWriter builds text with collapsed whitespace and at most one blank line between
// blocks.
type textWriter struct {
	b       strings.Builder
	breaks  int  // pending: 1 newline, 2 blank line
	space   bool // pending space
	lineLen int
	marker  bool // a list marker was just written: its item's text follows on the same line
}

func (w *textWriter) brk(n int) {
	if w.marker {
		return
	}
	if w.b.Len() > 0 && n > w.breaks {
		w.breaks = n
	}
	w.space = false
}

func (w *textWriter) flush() {
	if w.breaks > 0 && w.b.Len() > 0 {
		w.b.WriteString(strings.Repeat("\n", w.breaks))
		w.lineLen = 0
	} else if w.space && w.lineLen > 0 {
		w.b.WriteByte(' ')
		w.lineLen++
	}
	w.breaks, w.space = 0, false
}

// write adds inline text, collapsing whitespace.
func (w *textWriter) write(s string) {
	if s == "" {
		return
	}
	if first, _ := utf8.DecodeRuneInString(s); unicode.IsSpace(first) && w.lineLen > 0 {
		w.space = true
	}
	fields := strings.Fields(s)
	for i, f := range fields {
		if i > 0 {
			w.space = true
		}
		w.flush()
		w.b.WriteString(f)
		w.lineLen += len(f)
		w.marker = false
	}
	if len(fields) > 0 {
		if last, _ := utf8.DecodeLastRuneInString(s); unicode.IsSpace(last) {
			w.space = true
		}
	}
}

// raw adds preformatted text as is.
func (w *textWriter) raw(s string) {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if strings.TrimSpace(s) == "" {
		if strings.Contains(s, "\n") && w.lineLen > 0 {
			w.brk(1)
		}
		return
	}
	w.flush()
	w.b.WriteString(s)
	w.marker = false
	if i := strings.LastIndexByte(s, '\n'); i >= 0 {
		w.lineLen = len(s) - i - 1
	} else {
		w.lineLen += len(s)
	}
}

func renderText(root *html.Node) string {
	w := &textWriter{}
	var render func(n *html.Node, inContent, inPre bool)
	render = func(n *html.Node, inContent, inPre bool) {
		switch n.Type {
		case html.TextNode:
			if inPre {
				w.raw(n.Data)
			} else {
				w.write(n.Data)
			}
			return
		case html.ElementNode:
		case html.DocumentNode:
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				render(c, inContent, inPre)
			}
			return
		default:
			return
		}
		if dropped(n, inContent) {
			return
		}
		if n.DataAtom == atom.Article || n.DataAtom == atom.Main || strings.EqualFold(attr(n, "role"), "main") {
			inContent = true
		}
		switch n.DataAtom {
		case atom.Br:
			w.brk(1)
			return
		case atom.Pre:
			w.brk(2)
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				render(c, inContent, true)
			}
			w.brk(2)
			return
		case atom.Li:
			w.brk(1)
			w.flush()
			marker := "- "
			if n.Parent != nil && n.Parent.DataAtom == atom.Ol {
				i := 1
				for s := n.PrevSibling; s != nil; s = s.PrevSibling {
					if s.Type == html.ElementNode && s.DataAtom == atom.Li {
						i++
					}
				}
				marker = itoa(i) + ". "
			}
			w.b.WriteString(marker)
			w.lineLen += len(marker)
			w.marker = true
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				render(c, inContent, inPre)
			}
			w.marker = false
			// Items of one list are lines, whatever blocks they hold.
			if w.breaks > 1 {
				w.breaks = 1
			}
			w.brk(1)
			return
		case atom.Td, atom.Th:
			if w.lineLen > 0 {
				w.flush()
				w.b.WriteString(" | ")
				w.lineLen += 3
				w.space = false
			}
		}
		b := blockBreaks[n.DataAtom]
		if (n.DataAtom == atom.Ul || n.DataAtom == atom.Ol || n.DataAtom == atom.P) && insideItem(n) {
			b = 1
		}
		if b > 0 {
			w.brk(b)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			render(c, inContent, inPre)
		}
		if b > 0 {
			w.brk(b)
		}
	}
	render(root, false, false)
	return tidy(w.b.String())
}

// insideItem reports a node within a list item.
func insideItem(n *html.Node) bool {
	for p := n.Parent; p != nil; p = p.Parent {
		switch p.DataAtom {
		case atom.Li:
			return true
		case atom.Body, atom.Main, atom.Article, atom.Section:
			return false
		}
	}
	return false
}

func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return itoa(i/10) + string(rune('0'+i%10))
}

var manyBreaks = regexp.MustCompile(`\n{3,}`)

// tidy trims trailing spaces on lines and keeps at most one blank line.
func tidy(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRightFunc(l, unicode.IsSpace)
	}
	return strings.TrimSpace(manyBreaks.ReplaceAllString(strings.Join(lines, "\n"), "\n\n"))
}

// nodeText is the collapsed text of a node.
func nodeText(n *html.Node) string {
	var b strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			b.WriteString(n.Data)
			b.WriteByte(' ')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return b.String()
}

// cleanLine collapses whitespace, drops control characters and caps at 300 runes.
func cleanLine(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 300 {
		s = strings.TrimSpace(string(r[:300]))
	}
	return s
}
