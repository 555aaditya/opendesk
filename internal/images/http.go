package images

import (
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/opendesk/opendesk/internal/db"
	"github.com/opendesk/opendesk/internal/deps"
	"github.com/opendesk/opendesk/internal/httpx"
	"github.com/opendesk/opendesk/internal/storage"
)

// maxUploadBody leaves room for the multipart envelope around a 5 MB picture.
const maxUploadBody = MaxBytes + 64<<10

// UploadForm is the multipart body of every picture upload.
type UploadForm struct {
	File huma.FormFile `form:"file" required:"true" doc:"PNG, JPEG, GIF or WebP, at most 5 MB"`
}

// UploadInput is embedded in picture upload inputs.
type UploadInput struct {
	RawBody huma.MultipartFormFiles[UploadForm]
}

// UploadOperation fills the body limits of a picture upload operation.
func UploadOperation(api huma.API, op huma.Operation) huma.Operation {
	op.MaxBodyBytes = maxUploadBody
	op.Middlewares = append(op.Middlewares, func(ctx huma.Context, next func(huma.Context)) {
		r, w := humachi.Unwrap(ctx)
		if r.ContentLength > maxUploadBody {
			_ = huma.WriteErr(api, ctx, http.StatusRequestEntityTooLarge, "Pictures can be at most 5 MB.")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBody)
		next(ctx)
	})
	return op
}

// ReadUpload reads and processes the uploaded file. Errors are client errors.
func ReadUpload(in *UploadInput, fit Fit) (Processed, error) {
	defer removeForm(in.RawBody.Form)
	data := in.RawBody.Data()
	if data == nil || data.File.File == nil || !data.File.IsSet {
		return Processed{}, httpx.Validation("file is required")
	}
	defer data.File.Close()
	if data.File.Size > MaxBytes {
		return Processed{}, ClientError(ErrTooLarge)
	}
	b, err := ReadLimited(data.File.File, MaxBytes)
	if err != nil {
		return Processed{}, ClientError(err)
	}
	p, err := Process(b, fit)
	if err != nil {
		return Processed{}, ClientError(err)
	}
	return p, nil
}

func removeForm(f *multipart.Form) {
	if f != nil {
		_ = f.RemoveAll()
	}
}

// ClientError maps a processing error to its API answer.
func ClientError(err error) error {
	switch {
	case errors.Is(err, ErrTooLarge):
		return httpx.E(http.StatusRequestEntityTooLarge, "too_large", "Pictures can be at most 5 MB.")
	case errors.Is(err, ErrDimensions):
		return httpx.E(http.StatusUnprocessableEntity, "image_too_large", "Pictures must be 16 to 4096 pixels on each side, 16 megapixels at most.")
	case errors.Is(err, ErrUnsupported):
		return httpx.E(http.StatusUnprocessableEntity, "unsupported_image", "Use a PNG, JPEG, GIF or WebP picture.")
	}
	return err
}

// Register adds GET /v1/images/{id}.
func Register(d *deps.Deps, r chi.Router) {
	r.Get("/v1/images/{id}", func(w http.ResponseWriter, r *http.Request) { serve(d, w, r) })
}

func notFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusNotFound)
	_, _ = io.WriteString(w, `{"status":404,"title":"Not Found","detail":"Image not found","code":"not_found"}`)
}

func serve(d *deps.Deps, w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		notFound(w)
		return
	}
	size := "256"
	if s := r.URL.Query().Get("s"); s == "64" {
		size = "64"
	}
	ctx := r.Context()
	prefix, err := Lookup(ctx, d.DB.Pool, id)
	if err != nil {
		if !db.IsNotFound(err) {
			d.Log.Error("load image", "err", err, "request_id", httpx.RequestIDFrom(ctx))
		}
		notFound(w)
		return
	}
	body, err := d.Storage.Get(ctx, prefix+"/"+size+".png")
	if err != nil {
		if !errors.Is(err, storage.ErrNotFound) {
			d.Log.Error("read image", "err", err, "request_id", httpx.RequestIDFrom(ctx))
		}
		notFound(w)
		return
	}
	defer body.Close()
	b, err := ReadLimited(body, MaxBytes)
	if err != nil || Sniff(b) != FormatPNG {
		notFound(w)
		return
	}
	h := w.Header()
	h.Set("Content-Type", contentTypeP)
	h.Set("Content-Length", strconv.Itoa(len(b)))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("Content-Disposition", `inline; filename="`+id.String()+`.png"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}
