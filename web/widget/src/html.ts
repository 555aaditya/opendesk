// Agent HTML is sanitized server-side before storage. The widget still renders
// it through this allowlist, so only plain formatting and safe links survive.

const ALLOWED = new Set(["P", "BR", "A", "STRONG", "B", "EM", "I", "U", "S", "UL", "OL", "LI", "CODE", "PRE", "BLOCKQUOTE", "SPAN", "DIV", "H2", "H3", "HR"]);
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "LINK", "META", "IMG", "VIDEO", "AUDIO"]);

function clean(node: Node, doc: Document): Node | null {
  if (node.nodeType === 3) return doc.createTextNode(node.textContent ?? "");
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag)) return null;
  const kids = Array.from(el.childNodes)
    .map((c) => clean(c, doc))
    .filter((c): c is Node => c !== null);
  if (!ALLOWED.has(tag)) {
    const frag = doc.createDocumentFragment();
    kids.forEach((k) => frag.appendChild(k));
    return frag;
  }
  const out = doc.createElement(tag === "DIV" ? "p" : tag.toLowerCase());
  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href.trim())) {
      out.setAttribute("href", href.trim());
      out.setAttribute("target", "_blank");
      out.setAttribute("rel", "noopener noreferrer nofollow");
    }
  }
  kids.forEach((k) => out.appendChild(k));
  return out;
}

export function safeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const wrap = out.createElement("div");
  Array.from(doc.body.childNodes).forEach((n) => {
    const c = clean(n, out);
    if (c) wrap.appendChild(c);
  });
  return wrap.innerHTML;
}

/** Readable text colour (black or white) on a hex background. */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? "#0a0a0a" : "#ffffff";
}

export function isHex(v: string | null | undefined): v is string {
  return !!v && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

export function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export type SourceLink = { href: string; title: string };

/**
 * Agent replies list their cited sources as a trailing `<ul>` of links
 * (contracts/agent.md "Output and posting"). Split them off so they show as
 * chips under the reply. Takes and returns sanitized HTML.
 */
export function splitSources(html: string): { html: string; sources: SourceLink[] } {
  if (!html || !/<ul/i.test(html)) return { html, sources: [] };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const last = body.lastElementChild;
  while (body.lastChild && body.lastChild !== last && !(body.lastChild.textContent ?? "").trim()) body.lastChild.remove();
  if (!last || last.tagName !== "UL" || body.lastChild !== last) return { html, sources: [] };
  const items = Array.from(last.children);
  const sources: SourceLink[] = [];
  for (const li of items) {
    const a = li.tagName === "LI" && li.children.length === 1 ? li.firstElementChild : null;
    const href = a?.tagName === "A" ? (a.getAttribute("href") ?? "") : "";
    if (!a || !/^https?:/i.test(href) || (li.textContent ?? "").trim() !== (a.textContent ?? "").trim()) return { html, sources: [] };
    sources.push({ href, title: (a.textContent ?? "").trim() || href });
  }
  last.remove();
  // Nothing but the list: keep it as the body.
  if (!(body.textContent ?? "").trim() || !sources.length) return { html, sources: [] };
  return { html: body.innerHTML, sources };
}

/** The host of a URL, for a source chip's hint. */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
