// Word-level diff for the composer's rewrite and translate review. Pure, so it
// is easy to test. Long inputs fall back to a whole-block replacement so the
// LCS table stays small.

export type DiffPart = { kind: "same" | "add" | "del"; text: string };

/** Words and the whitespace after them stay together, so joins are lossless. */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

const MAX_TOKENS = 600;

function push(out: DiffPart[], kind: DiffPart["kind"], text: string) {
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ kind, text });
}

/** Diff two plain texts by word. */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    const out: DiffPart[] = [];
    if (before) out.push({ kind: "del", text: before });
    if (after) out.push({ kind: "add", text: after });
    return out;
  }
  const norm = (s: string) => s.trim();
  // LCS lengths, suffix form: dp[i][j] = LCS of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (norm(a[i]) === norm(b[j])) {
      push(out, "same", b[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push(out, "del", a[i++]);
    else push(out, "add", b[j++]);
  }
  while (i < a.length) push(out, "del", a[i++]);
  while (j < b.length) push(out, "add", b[j++]);
  return out;
}

/** Words changed on each side, for the summary line. */
export function diffStats(parts: DiffPart[]) {
  const count = (k: DiffPart["kind"]) => parts.filter((p) => p.kind === k).reduce((n, p) => n + (p.text.match(/\S+/g)?.length ?? 0), 0);
  const same = count("same");
  const added = count("add");
  const removed = count("del");
  return { added, removed, same, similarity: same / Math.max(1, same + Math.max(added, removed)) };
}

/** Editor HTML to plain text with paragraph breaks. */
export function htmlToPlain(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]+>/g, " ");
  const doc = new DOMParser().parseFromString(
    html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|h\d|blockquote|div)>/gi, "$&\n\n"),
    "text/html",
  );
  return (doc.body.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
