package knowledge

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/ai"
)

// Retrieval tuning. Semantic hits below minSimilarity and keyword hits below
// minCoverage are dropped (the looser draft thresholds of internal/ai; callers apply
// their own stricter threshold to Score). rrfK is the reciprocal rank fusion constant.
const (
	minSimilarity = 0.30
	minCoverage   = 0.34
	coverageCap   = 8
	rrfK          = 60
	maxRetrieve   = 20
)

// passageKind maps a source kind to the passage kind of contracts/agent.md.
func passageKind(sourceKind string) string {
	if sourceKind == KindWebsite {
		return "page"
	}
	return sourceKind
}

// retrievable is the SQL condition for sources used in answers: enabled, with a
// completed sync whose documents are in place. A re-sync keeps the last good documents
// answerable while it runs.
const retrievable = `s.enabled AND s.last_synced_at IS NOT NULL`

type hit struct {
	docID   uuid.UUID
	kind    string
	title   string
	url     *string
	text    string // the semantic chunk or the whole document
	rel     float64
	rrf     float64
	isChunk bool
}

// Retrieve returns up to k passages from the workspace's enabled, synced knowledge
// sources for query. With embeddings, cosine similarity over ai_embeddings (kind
// 'source') is fused with full-text search by reciprocal rank (k = 60); without, full
// text with keyword coverage. Passages are ordered by fused rank; Score is the cosine
// similarity of the best chunk or the keyword coverage, whichever is higher (0..1, the
// scales internal/ai uses for KB articles).
func (s *Service) Retrieve(ctx context.Context, wid uuid.UUID, query string, k int) ([]ai.Passage, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if r := []rune(query); len(r) > 4000 {
		query = string(r[:4000])
	}
	if k <= 0 {
		k = 6
	}
	k = min(k, maxRetrieve)
	words := keywords(query)

	byDoc := map[uuid.UUID]*hit{}
	var order []*hit
	add := func(list []hit) {
		for i, h := range list {
			x, ok := byDoc[h.docID]
			if !ok {
				c := h
				x = &c
				byDoc[h.docID] = x
				order = append(order, x)
			} else {
				if h.isChunk && !x.isChunk {
					x.text, x.isChunk = h.text, true
				}
				x.rel = max(x.rel, h.rel)
			}
			x.rrf += 1 / float64(rrfK+i+1)
		}
	}

	if s.vectors && s.ai.Embedder() != nil {
		sem, err := s.semanticHits(ctx, wid, query, k*4)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			s.d.Log.Warn("knowledge semantic retrieval failed, using full-text search", "err", err)
		}
		add(sem)
	}
	fts, err := s.ftsHits(ctx, wid, words, k*4)
	if err != nil {
		return nil, err
	}
	add(fts)

	sort.SliceStable(order, func(i, j int) bool {
		if order[i].rrf != order[j].rrf {
			return order[i].rrf > order[j].rrf
		}
		return order[i].rel > order[j].rel
	})
	out := make([]ai.Passage, 0, min(k, len(order)))
	for _, h := range order {
		if len(out) == k {
			break
		}
		url := ""
		if h.url != nil {
			url = *h.url
		}
		out = append(out, ai.Passage{Kind: passageKind(h.kind), ID: h.docID.String(), Title: h.title, URL: url,
			Text: bestPassage(h.text, words, passageRunes), Score: h.rel})
	}
	return out, nil
}

func (s *Service) semanticHits(ctx context.Context, wid uuid.UUID, query string, limit int) ([]hit, error) {
	emb := s.ai.Embedder()
	vec, err := s.queries.get(emb.Model(), query, func() ([]float32, error) {
		vs, err := emb.Embed(ctx, []string{query}, true)
		if err != nil {
			return nil, err
		}
		if len(vs) != 1 || len(vs[0]) == 0 {
			return nil, ai.ErrUnavailable
		}
		return vs[0], nil
	})
	if err != nil {
		return nil, err
	}
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT d.id, s.kind, d.title, d.url, e.content, 1 - (e.embedding <=> $3::vector) AS sim
		FROM ai_embeddings e
		JOIN ai_knowledge_docs d ON d.id = e.ref_id AND d.workspace_id = e.workspace_id
		JOIN ai_knowledge_sources s ON s.id = d.source_id AND s.workspace_id = d.workspace_id
		WHERE e.workspace_id = $1 AND e.kind = 'source' AND e.model = $2 AND e.dims = $4 AND `+retrievable+`
		ORDER BY e.embedding <=> $3::vector LIMIT $5`, wid, emb.Model(), vectorLiteral(vec), len(vec), limit*2)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []hit
	seen := map[uuid.UUID]bool{}
	for rows.Next() {
		var h hit
		if err := rows.Scan(&h.docID, &h.kind, &h.title, &h.url, &h.text, &h.rel); err != nil {
			return nil, err
		}
		// The best chunk of each document represents it.
		if h.rel < minSimilarity || seen[h.docID] || len(out) == limit {
			continue
		}
		seen[h.docID] = true
		h.isChunk = true
		out = append(out, h)
	}
	return out, rows.Err()
}

func (s *Service) ftsHits(ctx context.Context, wid uuid.UUID, words []string, limit int) ([]hit, error) {
	if len(words) == 0 {
		return nil, nil
	}
	rows, err := s.d.DB.Pool.Query(ctx, `SELECT d.id, s.kind, d.title, d.url, d.content
		FROM ai_knowledge_docs d JOIN ai_knowledge_sources s ON s.id = d.source_id AND s.workspace_id = d.workspace_id
		WHERE d.workspace_id = $1 AND `+retrievable+` AND d.search @@ to_tsquery('simple', $2)
		ORDER BY ts_rank_cd(d.search, to_tsquery('simple', $2)) DESC, d.updated_at DESC LIMIT $3`, wid, orQuery(words), limit*2)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type cand struct {
		h    hit
		hits int
	}
	var cands []cand
	for rows.Next() {
		var h hit
		if err := rows.Scan(&h.docID, &h.kind, &h.title, &h.url, &h.text); err != nil {
			return nil, err
		}
		n := keywordHits(words, h.title+" "+h.text)
		h.rel = min(float64(n)/float64(min(len(words), coverageCap)), 1)
		cands = append(cands, cand{h, n})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].h.rel > cands[j].h.rel })
	var out []hit
	for _, c := range cands {
		// One keyword alone matches too much; require two unless the query has one.
		if c.h.rel < minCoverage || (len(words) > 1 && c.hits < 2) {
			continue
		}
		out = append(out, c.h)
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

// --- Keywords (the same rules as internal/ai's KB retrieval) -------------------------

var queryWord = regexp.MustCompile(`[\p{L}\p{N}]+`)

var stopwords = map[string]bool{}

func init() {
	for _, w := range strings.Fields(`a an and are as at be but by can could did do does for from had has have how i if in into is it its
		me my no not of on or our please so that the their them then there they this to was we were what when where which who why will
		with would you your hi hello thanks thank hey can't cannot im i'm get got want need help
		der die das und ist ich nicht ein eine mit wie was zu den dem es sie wir bitte hallo danke
		le la les et est je pas un une avec comment pour de des du que qui bonjour merci
		el los las y es yo no una con como para que por hola gracias
		il lo gli che non per una ciao grazie
		o os as e não um uma com como para por olá obrigado`) {
		stopwords[w] = true
	}
}

// keywords are the meaningful lowercased words of a query, deduplicated, at most 12.
func keywords(q string) []string {
	var out []string
	seen := map[string]bool{}
	for _, w := range queryWord.FindAllString(strings.ToLower(q), 64) {
		if utf8.RuneCountInString(w) < 2 || stopwords[w] || seen[w] {
			continue
		}
		seen[w] = true
		out = append(out, w)
		if len(out) == 12 {
			break
		}
	}
	return out
}

// orQuery is a prefix tsquery matching any keyword.
func orQuery(words []string) string {
	parts := make([]string, len(words))
	for i, w := range words {
		parts[i] = stem(w) + ":*"
	}
	return strings.Join(parts, " | ")
}

// stem strips a few common inflections; a prefix match on the stem does the rest.
func stem(w string) string {
	for _, suf := range []string{"ing", "ed", "es", "s", "ly"} {
		if strings.HasSuffix(w, suf) && utf8.RuneCountInString(w)-len(suf) >= 4 {
			return strings.TrimSuffix(w, suf)
		}
	}
	return w
}

// keywordHits counts the keywords present in text (prefix match on stems).
func keywordHits(words []string, text string) int {
	have := map[string]bool{}
	for _, w := range queryWord.FindAllString(strings.ToLower(text), -1) {
		have[w] = true
	}
	hit := 0
	for _, k := range words {
		if have[k] {
			hit++
			continue
		}
		s := stem(k)
		for w := range have {
			if strings.HasPrefix(w, s) || strings.HasPrefix(s, w) && utf8.RuneCountInString(w) >= 4 {
				hit++
				break
			}
		}
	}
	return hit
}

// bestPassage picks the window of text, about n runes, with the most keyword hits,
// starting and ending at word boundaries.
func bestPassage(text string, words []string, n int) string {
	text = strings.TrimSpace(text)
	r := []rune(text)
	if len(r) <= n {
		return text
	}
	best, bestScore := 0, -1
	step := n / 4
	for start := 0; start < len(r); start += step {
		end := min(start+n, len(r))
		window := strings.ToLower(string(r[start:end]))
		score := 0
		for _, w := range words {
			score += strings.Count(window, stem(w))
		}
		if score > bestScore {
			best, bestScore = start, score
		}
		if end == len(r) {
			break
		}
	}
	start, end := best, min(best+n, len(r))
	if start > 0 {
		for i := start; i < min(start+40, end); i++ {
			if r[i] == ' ' || r[i] == '\n' {
				start = i + 1
				break
			}
		}
	}
	if end < len(r) {
		for i := end; i > max(end-40, start); i-- {
			if r[i-1] == ' ' || r[i-1] == '\n' {
				end = i - 1
				break
			}
		}
	}
	out := strings.TrimSpace(string(r[start:end]))
	if start > 0 {
		out = "…" + out
	}
	if end < len(r) {
		out += "…"
	}
	return out
}

// queryCache keeps recent query vectors briefly: one visitor message is retrieved for KB
// articles and knowledge sources and again by the agent's search tool.
type queryCache struct {
	mu sync.Mutex
	m  map[string]cachedVec
}

type cachedVec struct {
	v   []float32
	exp time.Time
}

const (
	queryCacheTTL  = 2 * time.Minute
	queryCacheSize = 256
)

func (c *queryCache) get(model, query string, embed func() ([]float32, error)) ([]float32, error) {
	key := model + "\x00" + query
	now := time.Now()
	c.mu.Lock()
	if e, ok := c.m[key]; ok && now.Before(e.exp) {
		c.mu.Unlock()
		return e.v, nil
	}
	c.mu.Unlock()
	v, err := embed()
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.m == nil {
		c.m = map[string]cachedVec{}
	}
	if len(c.m) >= queryCacheSize {
		for k, e := range c.m {
			if now.After(e.exp) {
				delete(c.m, k)
			}
		}
		if len(c.m) >= queryCacheSize {
			c.m = map[string]cachedVec{}
		}
	}
	c.m[key] = cachedVec{v: v, exp: now.Add(queryCacheTTL)}
	return v, nil
}
