package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Embedder turns text into vectors for semantic search.
type Embedder interface {
	// Model is recorded with every row; a model change makes old rows unused.
	Model() string
	// Embed returns one vector per text. query marks search queries (some models
	// embed queries and documents differently).
	Embed(ctx context.Context, texts []string, query bool) ([][]float32, error)
}

const embedBatch = 64

// Voyage is the Voyage AI embeddings API.
type Voyage struct {
	apiKey, model, url string
	http               *http.Client
}

// NewVoyage returns a Voyage embedder; model defaults to voyage-3.5.
func NewVoyage(apiKey, model string) *Voyage {
	if model == "" {
		model = "voyage-3.5"
	}
	return &Voyage{apiKey: apiKey, model: model, url: "https://api.voyageai.com/v1/embeddings", http: newHTTPClient()}
}

func (v *Voyage) Model() string { return v.model }

func (v *Voyage) Embed(ctx context.Context, texts []string, query bool) ([][]float32, error) {
	kind := "document"
	if query {
		kind = "query"
	}
	return embedBatches(texts, func(batch []string) ([][]float32, error) {
		return postEmbeddings(ctx, v.http, v.url, v.apiKey, map[string]any{"input": batch, "model": v.model, "input_type": kind}, len(batch))
	})
}

// OpenAIEmbedder is any OpenAI-compatible /embeddings endpoint.
type OpenAIEmbedder struct {
	apiKey, model, url string
	http               *http.Client
}

// NewOpenAIEmbedder returns an embedder for baseURL; model defaults to text-embedding-3-small.
func NewOpenAIEmbedder(baseURL, apiKey, model string) *OpenAIEmbedder {
	if model == "" {
		model = "text-embedding-3-small"
	}
	return &OpenAIEmbedder{apiKey: apiKey, model: model, url: strings.TrimRight(baseURL, "/") + "/embeddings", http: newHTTPClient()}
}

func (o *OpenAIEmbedder) Model() string { return o.model }

func (o *OpenAIEmbedder) Embed(ctx context.Context, texts []string, _ bool) ([][]float32, error) {
	return embedBatches(texts, func(batch []string) ([][]float32, error) {
		return postEmbeddings(ctx, o.http, o.url, o.apiKey, map[string]any{"input": batch, "model": o.model}, len(batch))
	})
}

func embedBatches(texts []string, fn func([]string) ([][]float32, error)) ([][]float32, error) {
	out := make([][]float32, 0, len(texts))
	for i := 0; i < len(texts); i += embedBatch {
		vs, err := fn(texts[i:min(i+embedBatch, len(texts))])
		if err != nil {
			return nil, err
		}
		out = append(out, vs...)
	}
	return out, nil
}

// postEmbeddings posts an embeddings request with retries and returns vectors in input order.
func postEmbeddings(ctx context.Context, c *http.Client, url, key string, body map[string]any, n int) ([][]float32, error) {
	ctx, cancel := context.WithTimeout(ctx, completeTimeout)
	defer cancel()
	raw, _ := json.Marshal(body)
	for attempt := 1; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
		if err != nil {
			return nil, ErrUnavailable
		}
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		res, err := c.Do(req)
		if err == nil && res.StatusCode == http.StatusOK {
			var r struct {
				Data []struct {
					Index     int       `json:"index"`
					Embedding []float32 `json:"embedding"`
				} `json:"data"`
			}
			err := json.NewDecoder(io.LimitReader(res.Body, 64<<20)).Decode(&r)
			res.Body.Close()
			if err != nil || len(r.Data) != n {
				return nil, ErrUnavailable
			}
			out := make([][]float32, n)
			for i, d := range r.Data {
				idx := d.Index
				if idx < 0 || idx >= n {
					idx = i
				}
				out[idx] = d.Embedding
			}
			for _, v := range out {
				if len(v) == 0 {
					return nil, ErrUnavailable
				}
			}
			return out, nil
		}
		var h http.Header
		status := 0
		if res != nil {
			h, status = res.Header, res.StatusCode
			_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<10))
			res.Body.Close()
		}
		if attempt >= maxAttempts || (status != 0 && !retryable(status)) || ctx.Err() != nil {
			if status != 0 {
				return nil, statusError(status)
			}
			return nil, ErrUnavailable
		}
		if sleepCtx(ctx, backoff(attempt, h)) != nil {
			return nil, ErrUnavailable
		}
	}
}

// Chunking. About 4 characters per token: chunks of ~800 tokens with ~100 overlapping.
const (
	chunkChars   = 3200
	overlapChars = 400
	maxChunks    = 40
)

// Chunk splits text into overlapping chunks at paragraph, then sentence, then word
// boundaries. Each chunk is at most chunkChars runes.
func Chunk(text string) []string {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil
	}
	if utf8.RuneCountInString(text) <= chunkChars {
		return []string{text}
	}
	// Units no longer than a chunk: paragraphs, with long ones split into sentences and words.
	var units []string
	for _, p := range strings.Split(text, "\n\n") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		units = append(units, splitLong(p, chunkChars-overlapChars)...)
	}
	var chunks []string
	var cur strings.Builder
	curLen := 0
	flush := func() {
		if curLen == 0 {
			return
		}
		chunks = append(chunks, strings.TrimSpace(cur.String()))
		tail := overlapTail(cur.String(), overlapChars)
		cur.Reset()
		cur.WriteString(tail)
		curLen = utf8.RuneCountInString(tail)
	}
	for _, u := range units {
		n := utf8.RuneCountInString(u)
		if curLen > 0 && curLen+2+n > chunkChars {
			flush()
		}
		if cur.Len() > 0 {
			cur.WriteString("\n\n")
			curLen += 2
		}
		cur.WriteString(u)
		curLen += n
		if len(chunks) >= maxChunks {
			break
		}
	}
	if s := strings.TrimSpace(cur.String()); s != "" && (len(chunks) == 0 || !strings.HasSuffix(chunks[len(chunks)-1], s)) {
		chunks = append(chunks, s)
	}
	if len(chunks) > maxChunks {
		chunks = chunks[:maxChunks]
	}
	return chunks
}

// splitLong breaks a paragraph longer than n runes at sentence ends, then at words.
func splitLong(p string, n int) []string {
	if utf8.RuneCountInString(p) <= n {
		return []string{p}
	}
	var out []string
	var cur strings.Builder
	for _, w := range strings.Fields(p) {
		if cur.Len() > 0 && utf8.RuneCountInString(cur.String())+1+utf8.RuneCountInString(w) > n {
			out = append(out, cur.String())
			cur.Reset()
		}
		if cur.Len() > 0 {
			cur.WriteByte(' ')
		}
		if utf8.RuneCountInString(w) > n {
			w = string([]rune(w)[:n])
		}
		cur.WriteString(w)
		// Prefer ending a piece at a sentence once it is reasonably long.
		if s := cur.String(); utf8.RuneCountInString(s) > n*3/4 && strings.ContainsAny(s[len(s)-1:], ".!?") {
			out = append(out, s)
			cur.Reset()
		}
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

// overlapTail returns about the last n runes of s, starting at a word boundary.
func overlapTail(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	tail := string(r[len(r)-n:])
	if i := strings.IndexAny(tail, " \n"); i >= 0 && i < len(tail)-1 {
		tail = tail[i+1:]
	}
	return strings.TrimSpace(tail)
}

// ContentHash identifies a document's content for one model, so unchanged content is
// not embedded again.
func ContentHash(model, text string) string {
	h := sha256.Sum256([]byte(model + "\x00" + text))
	return hex.EncodeToString(h[:])
}

// vectorLiteral formats a vector for a ::vector cast.
func vectorLiteral(v []float32) string {
	var b strings.Builder
	b.Grow(len(v) * 10)
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'g', 7, 32))
	}
	b.WriteByte(']')
	return b.String()
}
