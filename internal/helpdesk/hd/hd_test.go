package hd_test

import (
	"strings"
	"testing"

	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/helpdesk/hdtest"
)

func TestSanitizeRich(t *testing.T) {
	cases := []struct{ in, want, notWant string }{
		{`<p onclick="x()">Hi <script>alert(1)</script><strong>there</strong></p>`, `<p>Hi <strong>there</strong></p>`, "script"},
		{`<a href="javascript:alert(1)">x</a>`, ``, "javascript"},
		{`<a href="https://example.com">x</a>`, `href="https://example.com"`, ""},
		{`<img src="https://example.com/a.png" onerror="x">`, `<img src="https://example.com/a.png">`, "onerror"},
		{`<img src="data:image/png;base64,AAAA">`, ``, "data:"},
		{`<img src="/v1/attachments/0192f0c4-0000-7000-8000-000000000000?exp=1&sig=ab">`, `src="/v1/attachments/0192f0c4-0000-7000-8000-000000000000?exp=1&amp;sig=ab"`, ""},
		{`<span data-mention="0192f0c4-0000-7000-8000-000000000000">@Anna</span>`, `data-mention="0192f0c4-0000-7000-8000-000000000000"`, ""},
		{`<span data-mention="evil">@x</span>`, ``, "evil"},
		{`<h4>t</h4><div style="color:red">d</div><iframe src="https://x"></iframe>`, `td`, "iframe"},
		{`<h2>Title</h2><ul><li>a</li></ul><pre><code>x</code></pre><blockquote>q</blockquote><u>u</u><s>s</s><em>e</em><br>`, `<h2>Title</h2><ul><li>a</li></ul><pre><code>x</code></pre><blockquote>q</blockquote><u>u</u><s>s</s><em>e</em><br>`, ""},
	}
	for _, c := range cases {
		got := hd.SanitizeRich(c.in)
		if c.want != "" && !strings.Contains(got, c.want) {
			t.Errorf("SanitizeRich(%q) = %q, want contains %q", c.in, got, c.want)
		}
		if c.notWant != "" && strings.Contains(got, c.notWant) {
			t.Errorf("SanitizeRich(%q) = %q, must not contain %q", c.in, got, c.notWant)
		}
	}
}

func TestHTMLToText(t *testing.T) {
	got := hd.HTMLToText(`<p>Hello &amp; welcome</p><p>Line<br>two</p><style>p{}</style>`)
	if got != "Hello & welcome\nLine\ntwo" {
		t.Fatalf("got %q", got)
	}
	if hd.TextToHTML("a <b>\n\nc\nd") != "<p>a &lt;b&gt;</p><p>c<br>d</p>" {
		t.Fatal(hd.TextToHTML("a <b>\n\nc\nd"))
	}
}

func TestUploadChecks(t *testing.T) {
	if !hd.IsExecutable([]byte("MZ\x90\x00"), "report.pdf") || !hd.IsExecutable([]byte("hello"), "run.EXE") ||
		!hd.IsExecutable([]byte("#!/bin/sh\n"), "a.txt") || !hd.IsExecutable([]byte("\x7fELF"), "x") {
		t.Fatal("executable not refused")
	}
	if hd.IsExecutable([]byte("%PDF-1.7"), "a.pdf") || hd.IsExecutable([]byte("\xd0\xcf\x11\xe0"), "old.doc") {
		t.Fatal("document refused")
	}
	if ct := hd.DetectType([]byte("<html><script>x</script></html>"), "a.html"); strings.Contains(ct, "html") {
		t.Fatalf("active type kept: %s", ct)
	}
	if ct := hd.DetectType([]byte("\x89PNG\r\n\x1a\n"), "a.png"); ct != "image/png" {
		t.Fatalf("png: %s", ct)
	}
	if hd.CleanFilename("../../etc/pa\x00ss\nwd") != "passwd" {
		t.Fatal(hd.CleanFilename("../../etc/pa\x00ss\nwd"))
	}
}

func TestSlugify(t *testing.T) {
	if s := hd.Slugify("  Héllo, Wörld!  Getting started "); s != "hello-world-getting-started" {
		t.Fatal(s)
	}
}

func TestHarness(t *testing.T) {
	e := hdtest.New(t)
	ws := e.NewWorkspace()
	s, err := hd.LoadSettings(e.Ctx, e.D.DB.Pool, ws.ID)
	if err != nil || s.AutoClose() != 7 {
		t.Fatal(err, s)
	}
	e.SetSettings(ws, map[string]any{"auto_close_days": 3, "csat_enabled": true})
	s, _ = hd.LoadSettings(e.Ctx, e.D.DB.Pool, ws.ID)
	if s.AutoClose() != 3 || !s.CSATEnabled {
		t.Fatal(s)
	}
}
