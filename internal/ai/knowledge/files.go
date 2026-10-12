package knowledge

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/ledongthuc/pdf"
)

// Stored content types of knowledge files.
const (
	ctPDF      = "application/pdf"
	ctDOCX     = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	ctText     = "text/plain"
	ctMarkdown = "text/markdown"
	ctCSV      = "text/csv"
	ctHTML     = "text/html"
)

const (
	extractTimeout = 2 * time.Minute
	maxDocxXML     = 64 << 20
	maxPDFPages    = 2000
)

var (
	errNoText     = errors.New("no text")
	errUnreadable = errors.New("unreadable file")
)

// detectFile decides a file's type from its bytes, using the name only to tell text
// formats apart. Anything but PDF, DOCX, plain text, Markdown, HTML or CSV is refused.
func detectFile(head []byte, filename string, r io.ReaderAt, size int64) (string, bool) {
	ext := strings.ToLower(filepath.Ext(filename))
	switch {
	case bytes.HasPrefix(head, []byte("%PDF-")):
		return ctPDF, true
	case bytes.HasPrefix(head, []byte("PK\x03\x04")):
		if ext != ".docx" {
			return "", false
		}
		zr, err := zip.NewReader(r, size)
		if err != nil {
			return "", false
		}
		for _, f := range zr.File {
			if f.Name == "word/document.xml" {
				return ctDOCX, true
			}
		}
		return "", false
	case looksText(head):
		switch ext {
		case ".md", ".markdown", ".mdown", ".mkd":
			return ctMarkdown, true
		case ".csv":
			return ctCSV, true
		case ".html", ".htm", ".xhtml":
			return ctHTML, true
		case ".txt", ".text", "":
			if strings.HasPrefix(http.DetectContentType(head), "text/html") {
				return ctHTML, true
			}
			return ctText, true
		}
	}
	return "", false
}

// looksText reports UTF-8 text without NUL bytes (a cut rune at the end is allowed).
func looksText(head []byte) bool {
	if len(head) == 0 || bytes.IndexByte(head, 0) >= 0 {
		return false
	}
	for i := 0; i < 3 && len(head) > 0 && !utf8.Valid(head); i++ {
		head = head[:len(head)-1]
	}
	return utf8.Valid(head)
}

// extractFile returns the text of a stored file, or errNoText.
func extractFile(ctx context.Context, data []byte, contentType string) (title, text string, err error) {
	switch contentType {
	case ctPDF:
		text, err = withTimeout(ctx, func() (string, error) { return pdfText(data) })
	case ctDOCX:
		text, err = withTimeout(ctx, func() (string, error) { return docxText(data) })
	case ctMarkdown:
		text = markdownText(utf8Text(data))
	case ctCSV:
		text = csvText(utf8Text(data))
	case ctHTML:
		p := extractHTML(decodeText(data, "text/html"), nil)
		title, text = p.Title, p.Text
	default:
		text = tidy(utf8Text(data))
	}
	if err != nil {
		return "", "", err
	}
	text = strings.TrimSpace(text)
	if text == "" || !hasLetterOrDigit(text) {
		return "", "", errNoText
	}
	return title, text, nil
}

func hasLetterOrDigit(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0
}

// withTimeout runs a parser that cannot be canceled, giving up after extractTimeout. A
// parser panic on a malformed file becomes errUnreadable.
func withTimeout(ctx context.Context, fn func() (string, error)) (string, error) {
	type result struct {
		s   string
		err error
	}
	ch := make(chan result, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				ch <- result{"", errUnreadable}
			}
		}()
		s, err := fn()
		ch <- result{s, err}
	}()
	ctx, cancel := context.WithTimeout(ctx, extractTimeout)
	defer cancel()
	select {
	case r := <-ch:
		return r.s, r.err
	case <-ctx.Done():
		return "", errUnreadable
	}
}

func utf8Text(data []byte) string {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	return strings.ToValidUTF8(strings.ReplaceAll(string(data), "\r\n", "\n"), "�")
}

// --- PDF ------------------------------------------------------------------------------

// pdfText reads the text layer of every page. Text objects become lines, line moves
// new lines, and wide glyph gaps (TJ adjustments) spaces; pages are paragraphs.
func pdfText(data []byte) (string, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", errUnreadable
	}
	n := min(r.NumPage(), maxPDFPages)
	var out strings.Builder
	for i := 1; i <= n; i++ {
		t := pdfPageText(r.Page(i))
		if t = tidy(t); t != "" {
			out.WriteString(t)
			out.WriteString("\n\n")
		}
	}
	return out.String(), nil
}

func pdfPageText(p pdf.Page) (text string) {
	defer func() {
		if recover() != nil {
			text = ""
		}
	}()
	if p.V.IsNull() || p.V.Key("Contents").Kind() == pdf.Null {
		return ""
	}
	var b strings.Builder
	fonts := map[string]pdf.TextEncoding{}
	var enc pdf.TextEncoding
	newline := func() {
		if b.Len() > 0 && !strings.HasSuffix(b.String(), "\n") {
			b.WriteByte('\n')
		}
	}
	space := func() {
		if s := b.String(); len(s) > 0 && !strings.HasSuffix(s, " ") && !strings.HasSuffix(s, "\n") {
			b.WriteByte(' ')
		}
	}
	show := func(raw string) {
		if enc == nil {
			b.WriteString(pdfFallbackDecode(raw))
			return
		}
		b.WriteString(enc.Decode(raw))
	}
	var lastY float64
	haveY := false
	pdf.Interpret(p.V.Key("Contents"), func(stk *pdf.Stack, op string) {
		args := make([]pdf.Value, stk.Len())
		for i := len(args) - 1; i >= 0; i-- {
			args[i] = stk.Pop()
		}
		switch op {
		case "BT":
			haveY = false
		case "ET":
			newline()
		case "Tf":
			if len(args) == 2 {
				name := args[0].Name()
				e, ok := fonts[name]
				if !ok {
					f := p.Font(name)
					e = f.Encoder()
					fonts[name] = e
				}
				enc = e
			}
		case "Td", "TD":
			if len(args) == 2 {
				if args[1].Float64() != 0 {
					newline()
				} else if args[0].Float64() > 0 {
					space()
				}
			}
		case "Tm":
			if len(args) == 6 {
				y := args[5].Float64()
				if haveY && y != lastY {
					newline()
				} else if haveY {
					space()
				}
				lastY, haveY = y, true
			}
		case "T*":
			newline()
		case "'", "\"":
			newline()
			if len(args) > 0 {
				show(args[len(args)-1].RawString())
			}
		case "Tj":
			if len(args) == 1 {
				show(args[0].RawString())
			}
		case "TJ":
			if len(args) == 1 {
				v := args[0]
				for i := 0; i < v.Len(); i++ {
					x := v.Index(i)
					switch x.Kind() {
					case pdf.String:
						show(x.RawString())
					case pdf.Integer, pdf.Real:
						// A gap wider than a quarter of the font size separates words.
						if x.Float64() < -250 {
							space()
						}
					}
				}
			}
		}
	})
	return b.String()
}

// pdfFallbackDecode reads text shown before any font is set as Latin-1.
func pdfFallbackDecode(raw string) string {
	r := make([]rune, 0, len(raw))
	for i := 0; i < len(raw); i++ {
		r = append(r, rune(raw[i]))
	}
	return string(r)
}

// --- DOCX -----------------------------------------------------------------------------

// docxText reads word/document.xml: paragraphs as paragraphs, table rows as lines of
// cells separated by " | ".
func docxText(data []byte) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", errUnreadable
	}
	var doc *zip.File
	for _, f := range zr.File {
		if f.Name == "word/document.xml" {
			doc = f
			break
		}
	}
	if doc == nil {
		return "", errUnreadable
	}
	rc, err := doc.Open()
	if err != nil {
		return "", errUnreadable
	}
	defer rc.Close()
	dec := xml.NewDecoder(io.LimitReader(rc, maxDocxXML))
	var out, para strings.Builder
	var cells []string
	tableDepth, inText := 0, false
	endPara := func() {
		t := strings.TrimSpace(para.String())
		para.Reset()
		if tableDepth > 0 {
			if t != "" {
				if n := len(cells); n > 0 && cells[n-1] != "" {
					cells[n-1] += " " + t
				} else if n > 0 {
					cells[n-1] = t
				}
			}
			return
		}
		if t != "" {
			out.WriteString(t)
			out.WriteString("\n\n")
		}
	}
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", errUnreadable
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				para.WriteByte('\t')
			case "br", "cr":
				para.WriteByte('\n')
			case "tbl":
				tableDepth++
			case "tr":
				if tableDepth == 1 {
					cells = cells[:0]
				}
			case "tc":
				if tableDepth == 1 {
					cells = append(cells, "")
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				endPara()
			case "tr":
				if tableDepth == 1 {
					row := strings.TrimSpace(strings.Join(cells, " | "))
					if strings.Trim(row, "| ") != "" {
						out.WriteString(row)
						out.WriteByte('\n')
					}
				}
			case "tbl":
				tableDepth--
				if tableDepth == 0 {
					out.WriteByte('\n')
				}
			}
		case xml.CharData:
			if inText {
				para.Write(t)
			}
		}
	}
	return tidy(out.String()), nil
}

// --- Markdown and CSV ------------------------------------------------------------------

var (
	mdFrontMatter = regexp.MustCompile(`(?s)\A---\n.*?\n---\n`)
	mdComment     = regexp.MustCompile(`(?s)<!--.*?-->`)
	mdImage       = regexp.MustCompile(`!\[([^\]]*)\]\([^)]*\)`)
	mdLink        = regexp.MustCompile(`\[([^\]]+)\]\([^)]*\)`)
	mdRefDef      = regexp.MustCompile(`(?m)^\s{0,3}\[[^\]]+\]:\s+\S+.*$`)
	mdEmphasis    = regexp.MustCompile(`(\*\*|__)(\S(?:.*?\S)?)(\*\*|__)`)
	mdHeading     = regexp.MustCompile(`(?m)^\s{0,3}#{1,6}\s+`)
	mdTableRule   = regexp.MustCompile(`(?m)^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$`)
)

// markdownText keeps Markdown readable as text: front matter, comments, images and
// link targets dropped, headings and emphasis markers removed.
func markdownText(md string) string {
	md = mdFrontMatter.ReplaceAllString(md, "")
	md = mdComment.ReplaceAllString(md, "")
	md = mdImage.ReplaceAllString(md, "$1")
	md = mdLink.ReplaceAllString(md, "$1")
	md = mdRefDef.ReplaceAllString(md, "")
	md = mdEmphasis.ReplaceAllString(md, "$2")
	md = mdHeading.ReplaceAllString(md, "")
	md = mdTableRule.ReplaceAllString(md, "")
	return tidy(md)
}

// csvText writes each row as a line; with a header row, each value is labelled with its
// column ("Plan: Pro | Price: 20"). Rows are grouped in paragraphs of 20 so chunks keep
// whole rows.
func csvText(s string) string {
	r := csv.NewReader(strings.NewReader(s))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	r.ReuseRecord = false
	var rows [][]string
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			// A malformed file is read as plain lines from here on.
			return tidy(s)
		}
		rows = append(rows, rec)
	}
	if len(rows) == 0 {
		return ""
	}
	var header []string
	if len(rows) > 1 && isHeader(rows[0]) {
		header, rows = rows[0], rows[1:]
	}
	var b strings.Builder
	for i, rec := range rows {
		var cells []string
		for j, v := range rec {
			v = strings.Join(strings.Fields(v), " ")
			if v == "" {
				continue
			}
			if j < len(header) && strings.TrimSpace(header[j]) != "" {
				v = strings.TrimSpace(header[j]) + ": " + v
			}
			cells = append(cells, v)
		}
		if len(cells) == 0 {
			continue
		}
		b.WriteString(strings.Join(cells, " | "))
		if (i+1)%20 == 0 {
			b.WriteString("\n\n")
		} else {
			b.WriteByte('\n')
		}
	}
	return tidy(b.String())
}

// isHeader reports a first row of non-empty, non-numeric labels.
func isHeader(rec []string) bool {
	for _, v := range rec {
		v = strings.TrimSpace(v)
		if v == "" || len(v) > 80 {
			return false
		}
		if strings.IndexFunc(v, unicode.IsLetter) < 0 {
			return false
		}
	}
	return true
}

// splitParts divides a long text into parts of at most maxDocChars runes at paragraph
// boundaries, so every part is indexed.
func splitParts(text string, limit int) []string {
	if utf8.RuneCountInString(text) <= limit {
		return []string{text}
	}
	var parts []string
	var cur strings.Builder
	curLen := 0
	flush := func() {
		if s := strings.TrimSpace(cur.String()); s != "" {
			parts = append(parts, s)
		}
		cur.Reset()
		curLen = 0
	}
	for _, p := range strings.Split(text, "\n\n") {
		n := utf8.RuneCountInString(p)
		for n > limit {
			flush()
			r := []rune(p)
			parts = append(parts, strings.TrimSpace(string(r[:limit])))
			p = string(r[limit:])
			n = len(r) - limit
		}
		if curLen > 0 && curLen+2+n > limit {
			flush()
		}
		if curLen > 0 {
			cur.WriteString("\n\n")
			curLen += 2
		}
		cur.WriteString(p)
		curLen += n
	}
	flush()
	return parts
}

// partTitle names part i (0-based) of n of a file.
func partTitle(name string, i, n int) string {
	if n <= 1 {
		return name
	}
	return fmt.Sprintf("%s (part %d of %d)", name, i+1, n)
}
