package domain

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestResignAttachmentLinks(t *testing.T) {
	Configure("https://api.example.com", []byte(strings.Repeat("k", 32)))
	id := uuid.New()
	in := `<img src="https://api.example.com/v1/attachments/` + id.String() + `?exp=1&amp;sig=00">`
	out := ResignAttachmentLinks(in)
	if out == in || !strings.Contains(out, "&amp;sig=") {
		t.Fatalf("not re-signed: %s", out)
	}
	src := strings.TrimSuffix(strings.TrimPrefix(out, `<img src="https://api.example.com/v1/attachments/`+id.String()+`?exp=`), `">`)
	exp, sig, _ := strings.Cut(src, "&amp;sig=")
	if !VerifyAttachmentSig(id, exp, sig) {
		t.Fatalf("fresh link does not verify: %s", out)
	}
}
