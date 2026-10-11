package contacts_test

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/deps"

	"github.com/opendesk/opendesk/internal/helpdesk/contacts"
	"github.com/opendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/opendesk/opendesk/internal/images"
	"github.com/opendesk/opendesk/internal/jobs"
)

func pngBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{uint8(x), 80, uint8(y), 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

type pictured struct {
	ID           string  `json:"id"`
	AvatarURL    *string `json:"avatar_url"`
	AvatarSource *string `json:"avatar_source"`
}

// imagePath turns an avatar_url (on the test API base) into a path on the test server.
func imagePath(t *testing.T, u *string) string {
	t.Helper()
	if u == nil {
		t.Fatal("no avatar_url")
	}
	i := strings.Index(*u, "/v1/images/")
	if i < 0 {
		t.Fatalf("avatar_url %s", *u)
	}
	return (*u)[i:]
}

func TestContactAvatarUpload(t *testing.T) {
	e := hdtest.New(t, contacts.Register, func(d *deps.Deps, _ huma.API, r chi.Router) { images.Register(d, r) })
	ws := e.NewWorkspace()
	other := e.NewWorkspace()
	var c pictured
	e.Do("POST", "/v1/contacts", ws.Agent.As(ws), map[string]any{"email": "pic@example.com", "name": "Pic"}).Want(t, 201).JSON(t, &c)
	if c.AvatarURL != nil || c.AvatarSource != nil {
		t.Fatalf("new contact has a picture %+v", c)
	}
	path := "/v1/contacts/" + c.ID + "/avatar"

	// Viewers read only; another workspace cannot reach the contact; only images are accepted.
	e.UploadWith("PUT", path, ws.Viewer.As(ws), "a.png", pngBytes(t, 64, 64)).Want(t, 403)
	e.UploadWith("PUT", path, other.Admin.As(other), "a.png", pngBytes(t, 64, 64)).Want(t, 404)
	for name, body := range map[string][]byte{
		"a.svg":  []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
		"a.png":  append([]byte("<html><script>alert(1)</script>"), pngBytes(t, 32, 32)...),
		"a.html": []byte("<!doctype html><p>hi"),
	} {
		r := e.UploadWith("PUT", path, ws.Agent.As(ws), name, body).Want(t, 422)
		if !strings.Contains(string(r.Body), "unsupported_image") {
			t.Fatalf("%s: %s", name, r.Body)
		}
	}
	e.UploadWith("PUT", path, ws.Agent.As(ws), "tiny.png", pngBytes(t, 4, 4)).Want(t, 422)

	_, seq := e.Events(ws.ID, 0)
	e.UploadWith("PUT", path, ws.Agent.As(ws), "me.png", append(pngBytes(t, 300, 200), []byte("<script>x</script>")...)).Want(t, 200).JSON(t, &c)
	if c.AvatarSource == nil || *c.AvatarSource != "upload" {
		t.Fatalf("source %+v", c)
	}
	types, _ := e.Events(ws.ID, seq)
	if !contains(types, "contact.updated") {
		t.Fatalf("events %v", types)
	}
	var n int
	e.Scalar(`SELECT count(*) FROM audit_logs WHERE workspace_id = $1 AND action = 'contact.avatar_updated'`, &n, ws.ID)
	if n != 1 {
		t.Fatal("upload not audit-logged")
	}

	// The served picture is a fresh PNG with strict headers, at both sizes, without auth.
	img := imagePath(t, c.AvatarURL)
	for size, q := range map[int]string{256: "", 64: "?s=64"} {
		res, err := http.Get(e.Srv.URL + img + q)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Content-Type") != "image/png" || res.Header.Get("X-Content-Type-Options") != "nosniff" ||
			!strings.Contains(res.Header.Get("Content-Security-Policy"), "sandbox") || !strings.Contains(res.Header.Get("Cache-Control"), "immutable") {
			t.Fatalf("headers %d %v", res.StatusCode, res.Header)
		}
		if bytes.Contains(b, []byte("script")) {
			t.Fatal("payload served")
		}
		cfg, err := png.DecodeConfig(bytes.NewReader(b))
		if err != nil || cfg.Width != size {
			t.Fatalf("size %d: %+v %v", size, cfg, err)
		}
	}

	// Automatic sources never replace an upload.
	f := &images.Fetcher{Dev: true, GravatarBase: "http://127.0.0.1:1/avatar/"}
	e.SetSettings(ws, map[string]any{"gravatar": true})
	if err := images.Fetch(e.Ctx, e.D, f, jobs.AvatarFetchArgs{Owner: "contact", ID: uuid.MustParse(c.ID), WorkspaceID: ws.ID}); err != nil {
		t.Fatal(err)
	}
	var after pictured
	e.Do("GET", "/v1/contacts/"+c.ID, ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &after)
	if after.AvatarURL == nil || *after.AvatarURL != *c.AvatarURL {
		t.Fatal("upload was replaced")
	}

	// Removing it drops the image and queues the automatic lookup again.
	e.Do("DELETE", path, ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &after)
	if after.AvatarURL != nil || after.AvatarSource != nil {
		t.Fatalf("after delete %+v", after)
	}
	res, _ := http.Get(e.Srv.URL + img)
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatalf("old image still served: %d", res.StatusCode)
	}
	var due bool
	e.Scalar(`SELECT avatar_retry_at <= now() FROM contacts WHERE id = $1`, &due, c.ID)
	if !due {
		t.Fatal("lookup not queued again")
	}
}

func TestAutomaticPictures(t *testing.T) {
	e := hdtest.New(t, contacts.Register)
	ws := e.NewWorkspace()
	face := pngBytes(t, 120, 120)
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		switch {
		case strings.HasPrefix(r.URL.Path, "/avatar/") && r.URL.Query().Get("d") == "404" && strings.Contains(r.URL.Path, "25f7e41e"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(face)
		case r.URL.Path == "/":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<link rel="apple-touch-icon" sizes="180x180" href="/apple.png">`))
		case r.URL.Path == "/apple.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(pngBytes(t, 180, 180))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	f := &images.Fetcher{Dev: true, GravatarBase: srv.URL + "/avatar/", SiteBase: func(string) string { return srv.URL + "/" }}

	var known, unknown pictured
	e.Do("POST", "/v1/contacts", ws.Agent.As(ws), map[string]any{"email": "known@example.com"}).Want(t, 201).JSON(t, &known)
	e.Do("POST", "/v1/contacts", ws.Agent.As(ws), map[string]any{"email": "nobody@example.com"}).Want(t, 201).JSON(t, &unknown)
	fetch := func(owner, id string) {
		t.Helper()
		if err := images.Fetch(e.Ctx, e.D, f, jobs.AvatarFetchArgs{Owner: owner, ID: uuid.MustParse(id), WorkspaceID: ws.ID}); err != nil {
			t.Fatal(err)
		}
	}

	// Gravatar is off by default: nothing is sent.
	fetch("contact", known.ID)
	if hits != 0 {
		t.Fatal("gravatar contacted while off")
	}
	e.SetSettings(ws, map[string]any{"gravatar": true})
	e.Exec(`UPDATE contacts SET email = 'known@example.com' WHERE id = $1`, known.ID)
	// sha256("known@example.com") starts with 25f7e41e; the test server only knows that one.
	fetch("contact", known.ID)
	var got pictured
	e.Do("GET", "/v1/contacts/"+known.ID, ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &got)
	if got.AvatarSource == nil || *got.AvatarSource != "gravatar" || got.AvatarURL == nil {
		t.Fatalf("gravatar not applied %+v", got)
	}
	// A miss is remembered with a backoff.
	fetch("contact", unknown.ID)
	var failures int
	var wait time.Duration
	e.Scalar(`SELECT avatar_failures FROM contacts WHERE id = $1`, &failures, unknown.ID)
	e.Scalar(`SELECT avatar_retry_at - now() FROM contacts WHERE id = $1`, &wait, unknown.ID)
	if failures != 1 || wait < 23*time.Hour || wait > 25*time.Hour {
		t.Fatalf("miss: failures %d wait %s", failures, wait)
	}

	// Company logos come from the domain's icons.
	var co pictured
	e.Do("POST", "/v1/companies", ws.Agent.As(ws), map[string]any{"name": "Acme", "domain": "acme.example"}).Want(t, 201).JSON(t, &co)
	fetch("company", co.ID)
	e.Do("GET", "/v1/companies/"+co.ID, ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &got)
	if got.AvatarSource == nil || *got.AvatarSource != "domain" {
		t.Fatalf("logo %+v", got)
	}
	// Turning domain logos off removes them on the next run.
	e.SetSettings(ws, map[string]any{"domain_logos": false})
	fetch("company", co.ID)
	e.Do("GET", "/v1/companies/"+co.ID, ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &got)
	if got.AvatarURL != nil {
		t.Fatal("domain logo kept while off")
	}

	// The sweep queues due rows and the collector removes orphaned images.
	e.Exec(`UPDATE contacts SET avatar_retry_at = now() - interval '10 years' WHERE id = $1`, unknown.ID)
	if err := images.Sweep(e.Ctx, e.D); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, raw := range e.Jobs(jobs.AvatarFetchArgs{}.Kind(), ws.ID) {
		if strings.Contains(string(raw), unknown.ID) {
			found = true
		}
	}
	if !found {
		t.Fatal("sweep did not queue the due contact")
	}
	e.Exec(`INSERT INTO images (id, workspace_id, owner_type, owner_id, slot, source, storage_key, sha256, created_at)
		VALUES ($1, $2, 'contact', $3, 'avatar', 'gravatar', 'workspaces/x/images/orphan', '', now() - interval '2 hours')`, uuid.New(), ws.ID, known.ID)
	if err := images.Collect(e.Ctx, e.D); err != nil {
		t.Fatal(err)
	}
	var orphans int
	e.Scalar(`SELECT count(*) FROM images WHERE storage_key = 'workspaces/x/images/orphan'`, &orphans)
	if orphans != 0 {
		t.Fatal("orphan image kept")
	}
	var kept int
	e.Scalar(`SELECT count(*) FROM images WHERE owner_id = $1`, &kept, known.ID)
	if kept != 1 {
		t.Fatalf("referenced image removed: %d", kept)
	}
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
