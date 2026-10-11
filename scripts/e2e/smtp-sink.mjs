// A local SMTP sink for end-to-end runs: accepts every message and appends it,
// with quoted-printable parts decoded, as one JSON line {to, data} to a file, so flows can
// read links from ticket emails (CSAT) as well as account emails.
// Run the API with MAIL_DRIVER=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=<port> SMTP_TLS=none.
//
//   node smtp-sink.mjs <file> [port]   (default 2526, on 127.0.0.1)

import fs from "node:fs";
import net from "node:net";

const file = process.argv[2];
const port = Number(process.argv[3] || 2526);
if (!file) throw new Error("usage: node smtp-sink.mjs <file> [port]");

/** Undo quoted-printable soft breaks and escapes. */
function decodeQP(s) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Decodes the quoted-printable parts of a message, leaving 7bit/8bit parts as they are. */
function decode(raw) {
  return raw
    .split(/(?=^--)/m)
    .map((chunk) => {
      const split = chunk.search(/\r?\n\r?\n/);
      if (split < 0) return chunk;
      const head = chunk.slice(0, split);
      return /^Content-Transfer-Encoding:\s*quoted-printable/im.test(head) ? head + decodeQP(chunk.slice(split)) : chunk;
    })
    .join("");
}

net
  .createServer((sock) => {
    let buf = "";
    let inData = false;
    let rcpts = [];
    let data = "";
    const say = (l) => sock.write(l + "\r\n");
    say("220 e2e-sink ESMTP");
    sock.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          data += buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          fs.appendFileSync(file, JSON.stringify({ to: rcpts, data: decode(data.replace(/^\.\./gm, ".")) }) + "\n");
          rcpts = [];
          data = "";
          say("250 OK queued");
          continue;
        }
        const nl = buf.indexOf("\r\n");
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") sock.write("250-e2e-sink\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n");
        else if (cmd === "HELO") say("250 e2e-sink");
        else if (cmd === "MAIL") say("250 OK");
        else if (cmd === "RCPT") {
          rcpts.push(line.match(/<([^>]*)>/)?.[1] ?? "");
          say("250 OK");
        } else if (cmd === "DATA") {
          inData = true;
          say("354 End data with <CR><LF>.<CR><LF>");
        } else if (cmd === "QUIT") {
          say("221 Bye");
          sock.end();
        } else say("250 OK");
      }
    });
    sock.on("error", () => {});
  })
  .listen(port, "127.0.0.1", () => console.log(`smtp sink on 127.0.0.1:${port} -> ${file}`));
