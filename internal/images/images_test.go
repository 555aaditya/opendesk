package images

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/opendesk/opendesk/internal/netsafe"
)

func sample(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{uint8(x), uint8(y), 90, 255})
		}
	}
	return img
}

func encPNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func encJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func encGIF(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := gif.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func checkOut(t *testing.T, p Processed) {
	t.Helper()
	for size, b := range map[int][]byte{LargeSize: p.Large, SmallSize: p.Small} {
		if Sniff(b) != FormatPNG {
			t.Fatalf("%d px output is not PNG", size)
		}
		img, err := png.Decode(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		if r := img.Bounds(); r.Dx() != size || r.Dy() != size {
			t.Fatalf("output %v want %d", r, size)
		}
	}
	if len(p.SHA256) != 64 {
		t.Fatal("sha256")
	}
}

func TestProcessAcceptsRasterFormats(t *testing.T) {
	src := sample(300, 200)
	webp, err := os.ReadFile("testdata/small.webp")
	if err != nil {
		t.Fatal(err)
	}
	for name, b := range map[string][]byte{"png": encPNG(t, src), "jpeg": encJPEG(t, src), "gif": encGIF(t, src), "webp": webp} {
		t.Run(name, func(t *testing.T) {
			p, err := Process(b, Cover)
			if err != nil {
				t.Fatal(err)
			}
			checkOut(t, p)
		})
	}
	// Contain keeps the whole logo: the corners of a wide picture are transparent.
	p, err := Process(encPNG(t, src), Contain)
	if err != nil {
		t.Fatal(err)
	}
	img, _ := png.Decode(bytes.NewReader(p.Large))
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Fatal("contain should pad with transparency")
	}
}

func TestProcessRejectsNonImages(t *testing.T) {
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="10" height="10"/></svg>`)
	html := []byte("<!doctype html><script>alert(1)</script>")
	// An HTML page carrying a PNG later in the file: refused, nothing is sniffed past the start.
	htmlPolyglot := append([]byte("<html><script>alert(1)</script>"), encPNG(t, sample(32, 32))...)
	// A PNG signature followed by garbage does not decode.
	brokenPNG := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte("A"), 200)...)
	ico := []byte{0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 40, 0, 0, 0, 22, 0, 0, 0}
	for name, b := range map[string][]byte{"svg": svg, "html": html, "html_polyglot": htmlPolyglot, "broken_png": brokenPNG,
		"text": []byte("hello"), "empty": nil, "ico_bitmap": ico, "pdf": []byte("%PDF-1.7\n")} {
		if _, err := Process(b, Cover); !errors.Is(err, ErrUnsupported) {
			t.Errorf("%s: got %v, want ErrUnsupported", name, err)
		}
	}
}

func TestProcessStripsTrailingPayloads(t *testing.T) {
	// A valid PNG with an HTML payload appended (and a GIF with a ZIP, a GIFAR):
	// the stored file is a fresh encode, so none of the payload survives.
	payload := []byte("<html><script>alert(document.cookie)</script></html>PK\x03\x04")
	for name, b := range map[string][]byte{
		"png+html": append(encPNG(t, sample(64, 64)), payload...),
		"gif+zip":  append(encGIF(t, sample(64, 64)), payload...),
		"jpeg+zip": append(encJPEG(t, sample(64, 64)), payload...),
	} {
		p, err := Process(b, Cover)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for _, out := range [][]byte{p.Large, p.Small} {
			if bytes.Contains(out, []byte("script")) || bytes.Contains(out, []byte("PK\x03\x04")) {
				t.Fatalf("%s: payload survived processing", name)
			}
		}
	}
}

func TestProcessLimits(t *testing.T) {
	if _, err := Process(encPNG(t, sample(8, 8)), Cover); !errors.Is(err, ErrDimensions) {
		t.Fatalf("tiny: %v", err)
	}
	// A header that claims a huge canvas is refused before decoding (decompression bomb).
	bomb := encPNG(t, sample(20, 20))
	binary.BigEndian.PutUint32(bomb[16:20], 20000)
	binary.BigEndian.PutUint32(bomb[20:24], 20000)
	if _, err := Process(bomb, Cover); !errors.Is(err, ErrDimensions) && !errors.Is(err, ErrUnsupported) {
		t.Fatalf("bomb: %v", err)
	}
	cfgOnly := encPNG(t, sample(5000, 20))
	if _, err := Process(cfgOnly, Cover); !errors.Is(err, ErrDimensions) {
		t.Fatalf("wide: %v", err)
	}
	big := make([]byte, MaxBytes+1)
	copy(big, encPNG(t, sample(20, 20)))
	if _, err := Process(big, Cover); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("big: %v", err)
	}
	if _, err := ReadLimited(bytes.NewReader(big), MaxBytes); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("read limited: %v", err)
	}
}

// exifJPEG inserts an APP1 Exif segment with the orientation tag after SOI.
func exifJPEG(t *testing.T, img image.Image, orientation uint16) []byte {
	t.Helper()
	j := encJPEG(t, img)
	tiff := []byte("MM\x00\x2a\x00\x00\x00\x08\x00\x01\x01\x12\x00\x03\x00\x00\x00\x01")
	tiff = binary.BigEndian.AppendUint16(tiff, orientation)
	tiff = append(tiff, 0, 0, 0, 0, 0, 0)
	seg := append([]byte("Exif\x00\x00"), tiff...)
	app1 := []byte{0xff, 0xe1}
	app1 = binary.BigEndian.AppendUint16(app1, uint16(len(seg)+2))
	app1 = append(app1, seg...)
	return append(append([]byte{0xff, 0xd8}, app1...), j[2:]...)
}

func TestExifOrientation(t *testing.T) {
	// A tall picture, rotated 90 degrees by EXIF orientation 6, decodes wide.
	b := exifJPEG(t, sample(40, 80), 6)
	if o := jpegOrientation(b); o != 6 {
		t.Fatalf("orientation %d", o)
	}
	img, err := Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	if r := img.Bounds(); r.Dx() != 80 || r.Dy() != 40 {
		t.Fatalf("bounds %v", r)
	}
	if o := jpegOrientation(encJPEG(t, sample(20, 20))); o != 1 {
		t.Fatalf("no exif: %d", o)
	}
	if o := jpegOrientation([]byte{0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff}); o != 1 {
		t.Fatalf("truncated: %d", o)
	}
}

func icoWithPNG(p []byte) []byte {
	b := []byte{0, 0, 1, 0, 1, 0}
	e := make([]byte, 16)
	e[0], e[1] = 64, 64
	binary.LittleEndian.PutUint32(e[8:12], uint32(len(p)))
	binary.LittleEndian.PutUint32(e[12:16], 22)
	return append(append(b, e...), p...)
}

func TestICOWithPNG(t *testing.T) {
	inner := encPNG(t, sample(64, 64))
	got := icoPNG(icoWithPNG(inner))
	if !bytes.Equal(got, inner) {
		t.Fatal("embedded png not found")
	}
	if icoPNG(inner) != nil {
		t.Fatal("a png is not an ico")
	}
}

func TestBackoff(t *testing.T) {
	want := []int{1, 1, 2, 4, 8, 16, 30, 30}
	for n, days := range want {
		if got := Backoff(n); got != time.Duration(days)*24*time.Hour {
			t.Errorf("Backoff(%d) = %v, want %d days", n, got, days)
		}
	}
}

func TestGravatarURL(t *testing.T) {
	f := &Fetcher{}
	u := f.GravatarURL("  Someone@Example.COM ")
	// sha256("someone@example.com")
	if !strings.HasPrefix(u, "https://gravatar.com/avatar/") || !strings.Contains(u, "d=404") {
		t.Fatalf("url %s", u)
	}
	if u != f.GravatarURL("someone@example.com") {
		t.Fatal("not normalised")
	}
}

func TestFetchRefusesPrivateTargets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(encPNG(t, sample(64, 64)))
	}))
	defer srv.Close()
	ctx := context.Background()
	prod := &Fetcher{Dev: false}
	for _, u := range []string{srv.URL + "/a.png", "https://127.0.0.1/a.png", "https://10.0.0.1/a.png",
		"https://169.254.169.254/latest/meta-data", "https://localhost/a.png", "ftp://example.com/a.png", "https://user:pw@example.com/a.png"} {
		if _, err := prod.Image(ctx, u, Cover); err == nil {
			t.Errorf("%s: fetched", u)
		}
	}
	// The dialer refuses a loopback address even when the URL check is bypassed.
	if _, err := netsafe.Client(false, time.Second).Get(srv.URL); !errors.Is(err, netsafe.ErrBlocked) {
		t.Fatalf("dial: %v", err)
	}
	// A development instance may fetch from loopback (local testing) ...
	dev := &Fetcher{Dev: true}
	if _, err := dev.Image(ctx, srv.URL+"/a.png", Cover); err != nil {
		t.Fatalf("dev loopback: %v", err)
	}
	// ... but a redirect to a private address is still refused.
	redir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://10.1.2.3/a.png", http.StatusFound)
	}))
	defer redir.Close()
	if _, err := dev.Image(ctx, redir.URL, Cover); err == nil {
		t.Fatal("redirect to a private address was followed")
	}
}

func TestFetchChecksTypesAndSizes(t *testing.T) {
	big := make([]byte, MaxBytes+10)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/page.png":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write(encPNG(t, sample(64, 64)))
		case "/huge.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(big)
		case "/svg":
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write([]byte("<svg/>"))
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	f := &Fetcher{Dev: true}
	ctx := context.Background()
	if _, err := f.Image(ctx, srv.URL+"/page.png", Cover); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("html type: %v", err)
	}
	if _, err := f.Image(ctx, srv.URL+"/huge.png", Cover); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("huge: %v", err)
	}
	if _, err := f.Image(ctx, srv.URL+"/svg", Cover); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("svg: %v", err)
	}
	if _, err := f.Image(ctx, srv.URL+"/missing.png", Cover); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
	if _, err := f.Image(ctx, srv.URL+"/loop", Cover); err == nil {
		t.Fatal("redirect loop")
	}
}

func TestDomainLogo(t *testing.T) {
	icon := encPNG(t, sample(180, 180))
	var srvURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><link rel="icon" href="/logo.svg" type="image/svg+xml">
				<link rel="icon" sizes="16x16" href="/tiny.png"><link rel="apple-touch-icon" href="/touch.png">
				<link rel="manifest" href="/site.webmanifest"></head></html>`))
		case "/touch.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(icon)
		case "/site.webmanifest":
			w.Header().Set("Content-Type", "application/manifest+json")
			_, _ = w.Write([]byte(`{"icons":[{"src":"/missing-512.png","sizes":"512x512","type":"image/png"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	srvURL = srv.URL
	f := &Fetcher{Dev: true, SiteBase: func(string) string { return srvURL + "/" }}
	p, err := f.DomainLogo(context.Background(), "example.com")
	if err != nil {
		t.Fatal(err)
	}
	checkOut(t, p)
	if _, err := f.DomainLogo(context.Background(), "not a domain"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invalid domain: %v", err)
	}
	empty := httptest.NewServer(http.NotFoundHandler())
	defer empty.Close()
	f2 := &Fetcher{Dev: true, SiteBase: func(string) string { return empty.URL + "/" }}
	if _, err := f2.DomainLogo(context.Background(), "example.com"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no icons: %v", err)
	}
}

func TestValidDomain(t *testing.T) {
	for d, ok := range map[string]bool{"example.com": true, "sub.example.co.uk": true, "localhost": false, "127.0.0.1": false,
		"exa mple.com": false, "example.com/path": false, "": false} {
		if ValidDomain(d) != ok {
			t.Errorf("ValidDomain(%q) != %v", d, ok)
		}
	}
}
