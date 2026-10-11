// Client-side sanitizing for stored HTML (articles, messages). The server
// already sanitizes before storage; this is a second, strict layer before any
// dangerouslySetInnerHTML.

import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
  "a", "b", "strong", "i", "em", "u", "s", "strike", "del", "p", "br", "hr", "div", "span",
  "ul", "ol", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "img", "figure", "figcaption", "sub", "sup", "small", "mark",
];
const ALLOWED_ATTR = ["href", "title", "alt", "src", "width", "height", "colspan", "rowspan", "class", "data-id", "target", "rel"];

let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (/^\s*(javascript|data|vbscript):/i.test(href)) node.removeAttribute("href");
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (!/^(https?:|blob:|data:image\/(png|gif|jpe?g|webp|svg\+xml);|\/)/i.test(src)) node.removeAttribute("src");
      node.setAttribute("loading", "lazy");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
}

export function sanitizeHtml(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTR, "loading", "referrerpolicy"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|data:image\/|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
