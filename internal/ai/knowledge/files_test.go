package knowledge

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"
)

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestExtractPDF(t *testing.T) {
	_, text, err := extractFile(context.Background(), readFixture(t, "manual.pdf"), ctPDF)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Acme Router Manual", "Resetting the router", "Hold the reset button for ten seconds", "Warranty: every router is covered for two years."} {
		if !strings.Contains(text, want) {
			t.Errorf("pdf text lacks %q:\n%s", want, text)
		}
	}
	if !strings.Contains(text, "blinks.\n\nWarranty") {
		t.Errorf("pages are not paragraphs:\n%s", text)
	}
	if _, _, err := extractFile(context.Background(), readFixture(t, "empty.pdf"), ctPDF); !errors.Is(err, errNoText) {
		t.Errorf("empty pdf: %v", err)
	}
	if _, _, err := extractFile(context.Background(), []byte("%PDF-1.4 garbage"), ctPDF); err == nil || errors.Is(err, errNoText) {
		t.Errorf("broken pdf: %v", err)
	}
}

func TestExtractDOCX(t *testing.T) {
	_, text, err := extractFile(context.Background(), readFixture(t, "shipping.docx"), ctDOCX)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Shipping policy\n\nOrders ship within two business days.", "Region | Days\nEurope | 3", "Returns are free for thirty days."} {
		if !strings.Contains(text, want) {
			t.Errorf("docx text lacks %q:\n%s", want, text)
		}
	}
	for _, bad := range []string{"PAGE", "removed words"} {
		if strings.Contains(text, bad) {
			t.Errorf("docx text has %q:\n%s", bad, text)
		}
	}
}

func TestExtractTextFormats(t *testing.T) {
	ctx := context.Background()
	_, md, err := extractFile(ctx, []byte("---\ntitle: x\n---\n# Refunds\n\nSee **the policy** and [our page](https://x.test).\n\n![logo](l.png)\n<!-- hidden -->\n"), ctMarkdown)
	if err != nil || md != "Refunds\n\nSee the policy and our page.\n\nlogo" {
		t.Errorf("markdown %q %v", md, err)
	}
	_, csvT, err := extractFile(ctx, []byte("Plan,Price\nPro,20\n\"Team, yearly\",200\n"), ctCSV)
	if err != nil || csvT != "Plan: Pro | Price: 20\nPlan: Team, yearly | Price: 200" {
		t.Errorf("csv %q %v", csvT, err)
	}
	_, rows, _ := extractFile(ctx, []byte("1,2\n3,4\n"), ctCSV)
	if rows != "1 | 2\n3 | 4" {
		t.Errorf("csv without header %q", rows)
	}
	title, h, err := extractFile(ctx, []byte("<html><head><title>FAQ</title></head><body><nav>menu</nav><main><h2>Q</h2><p>A</p></main></body></html>"), ctHTML)
	if err != nil || title != "FAQ" || h != "Q\n\nA" {
		t.Errorf("html %q %q %v", title, h, err)
	}
	_, txt, err := extractFile(ctx, []byte("\xef\xbb\xbfLine one\r\n\r\n\r\n\r\nLine two  \n"), ctText)
	if err != nil || txt != "Line one\n\nLine two" {
		t.Errorf("text %q %v", txt, err)
	}
	if _, _, err := extractFile(ctx, []byte("   \n\n"), ctText); !errors.Is(err, errNoText) {
		t.Errorf("blank text: %v", err)
	}
}

func TestDetectFile(t *testing.T) {
	docx := readFixture(t, "shipping.docx")
	var zipNoDoc bytes.Buffer
	zw := zip.NewWriter(&zipNoDoc)
	w, _ := zw.Create("other.xml")
	_, _ = w.Write([]byte("<x/>"))
	_ = zw.Close()
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"manual.pdf", readFixture(t, "manual.pdf"), ctPDF},
		{"renamed.txt", readFixture(t, "manual.pdf"), ctPDF},
		{"shipping.docx", docx, ctDOCX},
		{"shipping.zip", docx, ""},
		{"fake.docx", zipNoDoc.Bytes(), ""},
		{"notes.txt", []byte("hello"), ctText},
		{"notes", []byte("hello"), ctText},
		{"page.txt", []byte("<!doctype html><html><body>x</body></html>"), ctHTML},
		{"README.md", []byte("# Hi"), ctMarkdown},
		{"prices.csv", []byte("a,b\n1,2"), ctCSV},
		{"page.htm", []byte("<p>x</p>"), ctHTML},
		{"setup.exe", []byte("MZ\x90\x00\x03"), ""},
		{"script.sh", []byte("#!/bin/sh\necho hi"), ""},
		{"data.json", []byte(`{"a":1}`), ""},
		{"image.png", []byte("\x89PNG\r\n\x1a\n\x00\x00"), ""},
		{"utf16.txt", []byte("\xff\xfeh\x00i\x00"), ""},
	}
	for _, c := range cases {
		head := c.data
		if len(head) > 512 {
			head = head[:512]
		}
		got, ok := detectFile(head, c.name, bytes.NewReader(c.data), int64(len(c.data)))
		if got != c.want || ok != (c.want != "") {
			t.Errorf("detect(%s) = %q %v, want %q", c.name, got, ok, c.want)
		}
	}
}

func TestSplitParts(t *testing.T) {
	para := strings.Repeat("word ", 30) // 150 chars
	text := strings.TrimSpace(strings.Repeat(para+"\n\n", 10))
	parts := splitParts(text, 400)
	if len(parts) < 4 {
		t.Fatalf("%d parts", len(parts))
	}
	total := 0
	for _, p := range parts {
		if n := len([]rune(p)); n > 400 {
			t.Fatalf("part of %d runes", n)
		}
		total += strings.Count(p, "word")
	}
	if total != 300 {
		t.Fatalf("lost words: %d", total)
	}
	if got := splitParts(strings.Repeat("x", 1000), 400); len(got) != 3 {
		t.Fatalf("long paragraph split into %d", len(got))
	}
	if partTitle("Guide.pdf", 1, 3) != "Guide.pdf (part 2 of 3)" || partTitle("Guide.pdf", 0, 1) != "Guide.pdf" {
		t.Fatal("part titles")
	}
}

func TestExtractHTMLStructure(t *testing.T) {
	src := `<html><head><title> Pricing  | Acme </title><meta name="robots" content="noindex, nofollow"></head><body>
	<div class="site-header"><a href="/a">A</a></div>
	<div role="navigation">MENU</div>
	<article><header><h1>Plans</h1></header>
	<p>Choose a <b>plan</b>that fits.</p>
	<ul><li><p>Starter</p></li><li>Growth<ul><li>Nested</li></ul></li></ul>
	<pre>line 1
  line 2</pre>
	<div class="consent-dialog">We use cookies</div>
	<p hidden>HIDDEN</p><p style="display: none">HIDDEN2</p>
	</article></body></html>`
	p := extractHTML(src, mustURL(t, "https://acme.test/pricing"))
	if p.Title != "Pricing | Acme" || !p.NoIndex || !p.NoFollow {
		t.Errorf("meta %+v", p)
	}
	want := "Plans\n\nChoose a planthat fits.\n\n- Starter\n- Growth\n- Nested\n\nline 1\n  line 2"
	if p.Text != want {
		t.Errorf("text:\n%q\nwant:\n%q", p.Text, want)
	}
	if len(p.Links) != 1 || p.Links[0] != "https://acme.test/a" {
		t.Errorf("links %v", p.Links)
	}
}
