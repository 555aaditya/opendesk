// A customer site for the widget runs: serves web/dist/widget at /widget and
// a host page at / that embeds it. Query params on /: key (widget key), api
// (API origin for data-api), and uid, hash, email, name to identify a user.
//
//   node widget-host.mjs [port]   (default 8899, on 127.0.0.1)

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.argv[2] || 8899);
const dist = path.resolve(import.meta.dirname, "../../web/dist/widget");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(q) {
  const identify = q.get("uid")
    ? `opendesk("identify", ${JSON.stringify({ user_id: q.get("uid"), user_hash: q.get("hash") ?? "", email: q.get("email") ?? undefined, name: q.get("name") ?? undefined })});`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Customer site</title></head>
<body><h1>Customer site</h1>
<script>
window.opendesk = window.opendesk || function () { (window.opendesk.q = window.opendesk.q || []).push(arguments); };
${identify.replace(/</g, "\\u003c")}
</script>
<script src="/widget/v1.js" data-key="${esc(q.get("key") ?? "")}" data-api="${esc(q.get("api") ?? "")}" async></script>
</body></html>`;
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${port}`);
    if (u.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page(u.searchParams));
    }
    if (u.pathname.startsWith("/widget/")) {
      const file = path.join(dist, path.normalize(u.pathname.slice("/widget/".length)));
      if (file.startsWith(dist + path.sep) && fs.existsSync(file)) {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
        return fs.createReadStream(file).pipe(res);
      }
    }
    res.writeHead(404);
    res.end("not found");
  })
  .listen(port, "127.0.0.1", () => console.log(`widget host on http://127.0.0.1:${port}`));
