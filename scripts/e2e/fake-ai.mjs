// A tiny OpenAI-compatible server for end-to-end runs: /v1/chat/completions
// (plain, json_schema and SSE streaming) and /v1/embeddings. Answers are
// deterministic and plausible, so every AI feature can be exercised without a
// real provider. Usage: node fake-ai.mjs [port]  (default 9900)

import http from "node:http";

const port = Number(process.argv[2] || process.env.FAKE_AI_PORT || 9900);
const DIM = 1536;

function embed(text) {
  // Bag of hashed words, normalised: similar texts get similar vectors.
  const v = new Array(DIM).fill(0);
  for (const w of String(text).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    let h = 2166136261;
    for (const c of w) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    v[h % DIM] += 1;
  }
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}

function lastUser(messages) {
  const u = [...messages].reverse().find((m) => m.role === "user");
  return u?.content ?? "";
}

function jsonFor(schema, messages) {
  const user = lastUser(messages);
  switch (schema) {
    case "ticket_summary":
      return {
        summary: "The customer cannot sign in after resetting their password and wants help.",
        key_points: ["Password reset email arrived", "Login still fails", "Customer is waiting on a fix"],
        sentiment: "negative",
      };
    case "ticket_triage": {
      const tags = (user.match(/<available_tags>([\s\S]*?)<\/available_tags>/)?.[1] ?? "")
        .split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 1);
      return {
        tags, suggested_tags: ["login"], priority: "high", sentiment: "frustrated",
        language: /\bhola\b/i.test(user) ? "es" : "en", category: "account", summary: "Customer cannot sign in after a password reset.",
      };
    }
    case "translation": {
      const text = user.match(/<text[^>]*>([\s\S]*?)<\/text>/)?.[1] ?? "Hola";
      return { translation: `[es] ${text.trim()}`, source_language: "en" };
    }
    case "kb_article":
      return {
        title: "How to sign in after a password reset",
        body_html: "<h2>Steps</h2><ol><li>Open the reset link.</li><li>Choose a new password.</li><li>Sign in again.</li></ol>",
        excerpt: "What to do when signing in fails after a reset.",
      };
    case "widget_answer":
      return {
        answerable: true,
        answer: "You can reset your password from the sign-in page. Follow the link in the email and choose a new password.",
        source_ids: [1],
        wants_human: false,
      };
    default:
      return {};
  }
}

function textFor(messages) {
  const sys = messages.find((m) => m.role === "system")?.content ?? "";
  if (sys.includes("You edit support replies")) return "<p>Thanks so much for reaching out! Here is a friendlier version of your reply.</p>";
  if (sys.includes("You are the copilot")) return "The customer **cannot sign in** after resetting the password. Suggest clearing cookies.";
  return "Hi there,\n\nThanks for reaching out. I am sorry about the trouble signing in. **Please try resetting your password** from the sign-in page, then let me know how it goes.\n\nBest regards";
}

function chunks(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 12) out.push(s.slice(i, i + 12));
  return out;
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    let j = {};
    try { j = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
    if (req.url?.endsWith("/embeddings")) {
      const input = Array.isArray(j.input) ? j.input : [j.input];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        object: "list", model: j.model,
        data: input.map((t, index) => ({ object: "embedding", index, embedding: embed(t) })),
        usage: { prompt_tokens: 10, total_tokens: 10 },
      }));
      return;
    }
    if (!req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const messages = j.messages ?? [];
    const schema = j.response_format?.json_schema?.name;
    const content = j.response_format ? JSON.stringify(jsonFor(schema, messages)) : textFor(messages);
    if (j.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const c of chunks(content)) {
        res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ index: 0, delta: { content: c } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 30));
      }
      res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ model: j.model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 40 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      model: j.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    }));
  });
});

server.listen(port, "127.0.0.1", () => console.log(`fake AI on http://127.0.0.1:${port}/v1`));
