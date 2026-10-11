package email

import (
	"regexp"
	"strings"

	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// Quoted history and signature detection. A reply's visible body is what the person
// wrote; the full original stays in messages.full_html.

var (
	onWroteRe = regexp.MustCompile(`(?is)^\s*(` +
		`on\s.{1,300}\swrote\s?:|` +
		`le\s.{1,300}\sa\s[ée]crit\s?:|` +
		`am\s.{1,300}\sschrieb.{0,100}:|` +
		`el\s.{1,300}\sescribi[óo]\s?:|` +
		`op\s.{1,300}\sschreef.{0,60}:|` +
		`il\s.{1,300}\sha\sscritto\s?:|` +
		`em\s.{1,300}\sescreveu\s?:|` +
		`den\s.{1,300}\sskrev.{0,60}:` +
		`)\s*$`)
	originalMsgRe = regexp.MustCompile(`(?i)^\s*-{2,}\s*(original message|ursprüngliche nachricht|message d'origine|mensaje original|messaggio originale)\s*-{2,}`)
	underscoreRe  = regexp.MustCompile(`^\s*_{20,}\s*$`)
	headerFromRe  = regexp.MustCompile(`(?i)^\s*\*?(from|von|de|da|van)\s?:\*?\s+\S`)
	headerSentRe  = regexp.MustCompile(`(?i)^\s*\*?(sent|date|gesendet|datum|envoyé|enviado|inviato|verzonden)\s?:\*?\s`)
	mobileSigRe   = regexp.MustCompile(`(?i)^\s*(sent from my (iphone|ipad|android|mobile|phone|samsung|galaxy|blackberry)|sent from (outlook|mail) for (ios|android|iphone)|get outlook for (ios|android)|sent from yahoo mail)\b`)
	forwardSubjRe = regexp.MustCompile(`(?i)^\s*(fwd?|fw|tr|wg|rv|enc)\s*:`)
)

// isForward reports a forwarded message by its subject. Forwards keep their quoted
// content: the forwarded mail is the point of the message.
func isForward(subject string) bool { return forwardSubjRe.MatchString(subject) }

// stripQuotesText cuts quoted history and the signature from a plain-text reply.
func stripQuotesText(t string) (string, bool) {
	t = strings.ReplaceAll(t, "\r\n", "\n")
	lines := strings.Split(t, "\n")
	cut := -1
	for i := 0; i < len(lines) && cut < 0; i++ {
		line := strings.TrimRight(lines[i], " \t ")
		trimmed := strings.TrimSpace(strings.ReplaceAll(line, " ", " "))
		switch {
		case line == "--" || line == "-- " || trimmed == "--" && strings.HasPrefix(lines[i], "--"):
			cut = i
		case onWroteRe.MatchString(trimmed):
			cut = i
		case i+1 < len(lines) && onWroteRe.MatchString(trimmed+" "+strings.TrimSpace(lines[i+1])) &&
			startsAttribution(trimmed):
			cut = i
		case originalMsgRe.MatchString(trimmed):
			cut = i
		case underscoreRe.MatchString(trimmed) && nextHas(lines, i+1, 3, headerFromRe):
			cut = i
		case headerFromRe.MatchString(trimmed) && nextHas(lines, i+1, 5, headerSentRe):
			cut = i
		case mobileSigRe.MatchString(trimmed):
			cut = i
		case strings.HasPrefix(trimmed, ">") && quotedToEnd(lines, i):
			cut = i
		}
	}
	if cut < 0 {
		return strings.TrimSpace(t), false
	}
	out := strings.TrimSpace(strings.Join(lines[:cut], "\n"))
	if out == "" {
		return strings.TrimSpace(t), false
	}
	return out, true
}

func startsAttribution(s string) bool {
	l := strings.ToLower(s)
	for _, p := range []string{"on ", "le ", "am ", "el ", "op ", "il ", "em ", "den "} {
		if strings.HasPrefix(l, p) {
			return true
		}
	}
	return false
}

func nextHas(lines []string, from, n int, re *regexp.Regexp) bool {
	for j := from; j < len(lines) && j < from+n; j++ {
		if re.MatchString(strings.TrimSpace(lines[j])) {
			return true
		}
	}
	return false
}

// quotedToEnd reports that every non-blank line from i on is a "> " quote.
func quotedToEnd(lines []string, i int) bool {
	for _, l := range lines[i:] {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, ">") {
			return false
		}
	}
	return true
}

// quoteMarker reports a node that starts quoted history or a signature in HTML mail.
func quoteMarker(n *xhtml.Node) bool {
	if n.Type != xhtml.ElementNode {
		return false
	}
	id := strings.ToLower(attr(n, "id"))
	switch {
	case hasClass(n, "gmail_quote"), hasClass(n, "gmail_quote_container"), hasClass(n, "gmail_signature"),
		attr(n, "data-smartmail") == "gmail_signature":
		return true // Gmail
	case n.DataAtom == atom.Blockquote && strings.EqualFold(attr(n, "type"), "cite"):
		return true // Apple Mail, Thunderbird
	case hasClass(n, "moz-cite-prefix"), hasClass(n, "moz-signature"):
		return true // Thunderbird
	case id == "appendonsend", id == "divrplyfwdmsg", id == "stopspelling", id == "mail-editor-reference-message-container",
		hasClass(n, "OutlookMessageHeader"):
		return true // Outlook (web, desktop, mobile)
	case strings.Contains(strings.ToLower(attr(n, "class")), "yahoo_quoted"):
		return true // Yahoo
	case hasClass(n, "protonmail_quote"), hasClass(n, "protonmail_signature_block"):
		return true // Proton
	case hasClass(n, "zmail_extra"), hasClass(n, "zmail_extra_hr"):
		return true // Zoho
	}
	if n.DataAtom == atom.Div || n.DataAtom == atom.P {
		style := strings.ToLower(strings.ReplaceAll(attr(n, "style"), " ", ""))
		// Outlook desktop's reply header: a top border, then "From:".
		if strings.Contains(style, "border-top:solid") && headerFromRe.MatchString(nodeText(n)) {
			return true
		}
		// A "-- " signature separator on its own block.
		t := strings.TrimSpace(strings.ReplaceAll(nodeText(n), " ", " "))
		if t == "--" || strings.HasPrefix(t, "-- \n") {
			return true
		}
		if firstLine(t) == "--" {
			return true
		}
		// A plain "On ... wrote:" or "Original Message" line in its own block.
		if strings.Count(t, "\n") <= 2 && (onWroteRe.MatchString(strings.ReplaceAll(t, "\n", " ")) || originalMsgRe.MatchString(firstLine(t))) {
			return true
		}
	}
	return false
}

func firstLine(s string) string {
	l, _, _ := strings.Cut(s, "\n")
	return strings.TrimSpace(l)
}

func nodeText(n *xhtml.Node) string {
	var b strings.Builder
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		switch {
		case n.Type == xhtml.TextNode:
			b.WriteString(n.Data)
		case n.Type == xhtml.ElementNode && (n.DataAtom == atom.Br || n.DataAtom == atom.Div || n.DataAtom == atom.P):
			if n.DataAtom == atom.Br {
				b.WriteByte('\n')
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
		if n.Type == xhtml.ElementNode && (n.DataAtom == atom.Div || n.DataAtom == atom.P) {
			b.WriteByte('\n')
		}
		if b.Len() > 4000 {
			return
		}
	}
	walk(n)
	return b.String()
}

// stripQuotesHTML removes the first quote or signature marker and everything after it
// in document order. It returns false when nothing was removed or nothing would remain.
func stripQuotesHTML(doc *xhtml.Node) bool {
	marker := findFirst(doc, quoteMarker)
	if marker == nil {
		return false
	}
	// Drop an "On ... wrote:" attribution right before the quote.
	prev := marker.PrevSibling
	for prev != nil && isBlank(prev) {
		prev = prev.PrevSibling
	}
	if prev != nil && onWroteRe.MatchString(strings.TrimSpace(nodeText(prev))) {
		marker = prev
	}
	// Everything from marker to the end of the document goes.
	for n := marker; n != nil && n.DataAtom != atom.Body && n.Parent != nil; n = n.Parent {
		for sib := n.NextSibling; sib != nil; {
			next := sib.NextSibling
			n.Parent.RemoveChild(sib)
			sib = next
		}
	}
	parent := marker.Parent
	parent.RemoveChild(marker)
	trimTrailingBlank(parent)
	return true
}

// trimTrailingBlank drops the empty lines and spacer blocks a cut leaves at the end.
func trimTrailingBlank(n *xhtml.Node) {
	for n != nil {
		for n.LastChild != nil && isBlank(n.LastChild) {
			n.RemoveChild(n.LastChild)
		}
		if n.DataAtom == atom.Body || n.Parent == nil || n.FirstChild != nil {
			if n.DataAtom != atom.Body && n.Parent != nil && n.NextSibling == nil {
				n = n.Parent
				continue
			}
			return
		}
		// n is now empty: remove it and continue with its parent.
		p := n.Parent
		p.RemoveChild(n)
		n = p
	}
}

func isBlank(n *xhtml.Node) bool {
	switch n.Type {
	case xhtml.TextNode:
		return strings.TrimSpace(strings.ReplaceAll(n.Data, " ", " ")) == ""
	case xhtml.ElementNode:
		if n.DataAtom == atom.Br {
			return true
		}
		if n.DataAtom == atom.Img {
			return false
		}
		return strings.TrimSpace(strings.ReplaceAll(nodeText(n), " ", " ")) == "" &&
			findFirst(n, func(x *xhtml.Node) bool { return x.Type == xhtml.ElementNode && x.DataAtom == atom.Img }) == nil
	case xhtml.CommentNode:
		return true
	}
	return false
}
