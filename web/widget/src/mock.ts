// In-memory backend for the widget demo. Only bundled when __OD_WIDGET_MOCK__
// is true (WIDGET_MOCK=1 or the dev server); production builds drop it.

import type { Fetcher } from "./api";
import type { RtChannelLike, RtSocketLike, SocketFactory } from "./realtime";
import type { Conversation, Message } from "./types";

const WID = "ws_demo";
const contact = { id: "ct_demo", email: null as string | null, name: "", avatar_url: "" };
const agent = { id: "u_priya", name: "Priya Raman", avatar_url: "" };
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const wsToken = () => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ purpose: "widget_ws", sub: contact.id, wid: WID, exp: Date.now() / 1000 + 300 })}.mock`;

let n = 0;
const id = (p: string) => `${p}_${Date.now().toString(36)}${(++n).toString(36)}`;

const params = new URLSearchParams(location.search);
// Demo content in the visitor's language for ?od_lang=ja / ar screenshots.
const L = params.get("od_lang") ?? "";
type Copy = { q1: string; a1: string; q2: string; a2: string; subject: string; ai: string; aiSso: string; s1: string; s2: string; human: string };
const COPY: Record<string, Copy> = {
  en: {
    subject: "Exporting notebooks to PDF",
    q1: "Hi! Is there a way to export a whole notebook to PDF, not just single pages?",
    a1: "<p>Yes. Open the notebook, then choose <strong>File → Export → PDF</strong> and pick <em>Entire notebook</em>.</p>",
    q2: "Perfect, that did it. Thanks!",
    a2: "Glad that worked! Let us know if anything else comes up.",
    ai: "<p>Here's what usually helps. Open <strong>Settings → Workspace → Export</strong> and choose the notebooks you want; large exports arrive by email within a few minutes.</p>",
    aiSso: "<p>Sign-in loops with SSO usually mean the identity provider's signing certificate changed. An admin can upload the new certificate under <strong>Settings → Security → SSO</strong>, then everyone can sign in again.</p><p>While that's sorted, admins can still sign in with email and password.</p>",
    s1: "Set up SAML single sign-on",
    s2: "Rotate your SSO certificate",
    human: "Hi, Priya here from the Fieldnote team. I've checked your SSO settings: the certificate on file expires today. Can you send me the new one?",
  },
  ja: {
    subject: "ノートをPDFで書き出す",
    q1: "こんにちは。ページ単位ではなく、ノート全体をPDFで書き出す方法はありますか？",
    a1: "<p>はい。ノートを開いて <strong>ファイル → 書き出し → PDF</strong> を選び、<em>ノート全体</em> を指定してください。</p>",
    q2: "できました。ありがとうございます！",
    a2: "うまくいってよかったです。ほかにも何かあればお気軽にどうぞ。",
    ai: "<p><strong>設定 → ワークスペース → 書き出し</strong> から、書き出したいノートを選んでください。大きなファイルは数分以内にメールで届きます。</p>",
    aiSso: "<p>SSOでサインインが繰り返される場合、IDプロバイダーの署名証明書が更新された可能性があります。管理者が <strong>設定 → セキュリティ → SSO</strong> から新しい証明書をアップロードすると、再びサインインできるようになります。</p>",
    s1: "SAMLシングルサインオンを設定する",
    s2: "SSO証明書を更新する",
    human: "Fieldnoteサポートのプリヤです。SSOの設定を確認したところ、登録済みの証明書が本日で期限切れでした。新しい証明書をお送りいただけますか？",
  },
  ar: {
    subject: "تصدير الدفاتر بصيغة PDF",
    q1: "مرحبًا! هل يمكن تصدير دفتر كامل بصيغة PDF، وليس صفحات منفردة فقط؟",
    a1: "<p>نعم. افتح الدفتر، ثم اختر <strong>ملف ← تصدير ← PDF</strong> وحدّد <em>الدفتر بالكامل</em>.</p>",
    q2: "ممتاز، نجح الأمر. شكرًا!",
    a2: "يسعدنا ذلك! أخبرنا إن احتجت إلى أي شيء آخر.",
    ai: "<p>افتح <strong>الإعدادات ← مساحة العمل ← التصدير</strong> واختر الدفاتر التي تريدها؛ تصل الملفات الكبيرة عبر البريد الإلكتروني خلال دقائق.</p>",
    aiSso: "<p>تكرار تسجيل الدخول عبر SSO يعني غالبًا أن شهادة التوقيع لدى مزوّد الهوية قد تغيّرت. يمكن للمسؤول رفع الشهادة الجديدة من <strong>الإعدادات ← الأمان ← SSO</strong>، وبعدها يستطيع الجميع تسجيل الدخول مجددًا.</p>",
    s1: "إعداد تسجيل الدخول الموحّد SAML",
    s2: "تحديث شهادة SSO",
    human: "مرحبًا، معك بريا من فريق Fieldnote. راجعت إعدادات SSO لديك: الشهادة المسجّلة تنتهي صلاحيتها اليوم. هل يمكنك إرسال الشهادة الجديدة؟",
  },
};
const copy = COPY[L] ?? COPY.en;

function msg(ticket_id: string, dir: "inbound" | "outbound", text: string, minsAgo = 0, html?: string): Message {
  return {
    id: id("msg"),
    ticket_id,
    kind: "reply",
    direction: dir,
    author: dir === "inbound" ? { type: "contact", user: null, contact } : { type: "user", user: agent, contact: null },
    body_html: html ?? "",
    body_text: text,
    attachments: [],
    created_at: ago(minsAgo),
  };
}

const conversations: Conversation[] = [
  { id: "cv_1", subject: copy.subject, status: "solved", last_message_preview: copy.a2, last_message_at: ago(60 * 26) },
];
const messages: Record<string, Message[]> = {
  cv_1: [
    msg("cv_1", "inbound", copy.q1, 60 * 27),
    msg("cv_1", "outbound", "", 60 * 26.5, copy.a1),
    msg("cv_1", "inbound", copy.q2, 60 * 26.2),
    msg("cv_1", "outbound", copy.a2, 60 * 26),
  ],
};

const HELP = "https://example.com/help/fieldnote/articles";

/** The answer bot: a system reply with `ai: true`, cited articles linked in the body, a moment after the first message. */
function aiAnswer(tid: string, question: string) {
  setTimeout(() => {
    const sso = /sso|sign|log ?in|saml|ログイン|サインイン|تسجيل/i.test(question);
    const links = sso
      ? [
          { title: copy.s1, url: `${HELP}/saml-sso` },
          { title: copy.s2, url: `${HELP}/rotate-sso-certificate` },
        ]
      : [{ title: copy.subject, url: `${HELP}/export-notebooks` }];
    const html = (sso ? copy.aiSso : copy.ai) + `<ul>${links.map((l) => `<li><a href="${l.url}">${l.title}</a></li>`).join("")}</ul>`;
    const m: Message = {
      ...msg(tid, "outbound", html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 0, html),
      author: { type: "system", user: null, contact: null },
      ai: true,
    };
    messages[tid]?.push(m);
    broadcast("event", { id: id("ev"), seq: n, type: "message.created", data: { ticket_id: tid, message: m }, topics: [] });
  }, 1400);
}

function humanReply(tid: string) {
  setTimeout(() => broadcast("typing", { ticket_id: tid, user: { id: agent.id, name: agent.name } }), 1500);
  setTimeout(() => {
    const m = msg(tid, "outbound", copy.human);
    messages[tid]?.push(m);
    broadcast("event", { id: id("ev"), seq: n, type: "message.created", data: { ticket_id: tid, message: m }, topics: [] });
  }, 4200);
}

// One fake channel per topic; the fetch handler pushes into it.
const channels: { topic: string; handlers: Record<string, ((p: unknown) => void)[]> }[] = [];
function broadcast(event: string, payload: unknown) {
  for (const ch of channels) (ch.handlers[event] ?? []).forEach((h) => h(payload));
}

const replies = [
  "Thanks for reaching out! Let me take a look at that for you.",
  "Good question. You can find that under Settings → Workspace. Want me to walk you through it?",
  "I've passed this on to our engineers and will update you here as soon as I hear back.",
];
let replyIdx = 0;

function agentReply(tid: string) {
  setTimeout(() => broadcast("typing", { ticket_id: tid, user: { id: agent.id, name: agent.name } }), 900);
  setTimeout(() => broadcast("typing", { ticket_id: tid, user: { id: agent.id, name: agent.name } }), 3200);
  setTimeout(() => {
    const m = msg(tid, "outbound", replies[replyIdx++ % replies.length]);
    messages[tid]?.push(m);
    broadcast("event", { id: id("ev"), seq: n, type: "message.created", data: { ticket_id: tid, message: m }, topics: [] });
  }, 4600);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const mockFetch: Fetcher = async (url, init) => {
  await new Promise((r) => setTimeout(r, 120));
  const u = new URL(url, location.href);
  const path = u.pathname;
  const method = (init.method ?? "GET").toUpperCase();
  const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};

  if (path === "/v1/widget/config")
    return json({
      workspace_name: "Fieldnote",
      brand_color: u.searchParams.get("key") === "wk_brand" ? "#3b5bdb" : null,
      greeting: "Hi there. How can we help?",
      help_center_url: "https://example.com/help/fieldnote",
      require_email: u.searchParams.get("key") === "wk_email",
      locale: params.get("od_ws_lang") ?? "en",
      ai_answers: params.get("od_bot") !== "0",
    });
  if (path === "/v1/widget/session") {
    if (typeof body.email === "string") contact.email = body.email;
    if (typeof body.name === "string") contact.name = body.name;
    return json({ visitor_token: "od_vis_mock", contact: { ...contact }, ws_token: wsToken(), gateway_url: "wss://mock.invalid/socket/widget" });
  }
  if (path === "/v1/widget/conversations" && method === "GET") return json({ data: conversations, next_cursor: null });
  if (path === "/v1/widget/conversations" && method === "POST") {
    const cid = id("cv");
    const text = String(body.body ?? "");
    const conv: Conversation = { id: cid, subject: text.slice(0, 60) || "New conversation", status: "open", last_message_preview: text, last_message_at: ago(0) };
    conversations.unshift(conv);
    const first = msg(cid, "inbound", text);
    messages[cid] = [first];
    // The answer bot takes the first message (?od_bot=0 turns it off).
    if (params.get("od_bot") === "0") agentReply(cid);
    else aiAnswer(cid, text);
    return json({ conversation: conv, message: first }, 201);
  }
  const h = /^\/v1\/widget\/conversations\/([^/]+)\/handoff$/.exec(path);
  if (h && method === "POST") {
    const conv = conversations.find((c) => c.id === h[1]);
    if (!conv) return json({ status: 404, title: "Not found", code: "not_found" }, 404);
    conv.ai_handoff = true;
    humanReply(conv.id);
    return json(conv, 200);
  }
  const m = /^\/v1\/widget\/conversations\/([^/]+)\/messages$/.exec(path);
  if (m) {
    const cid = m[1];
    if (method === "GET") return json({ data: messages[cid] ?? [], next_cursor: null });
    const reply = msg(cid, "inbound", String(body.body ?? ""));
    (messages[cid] ??= []).push(reply);
    agentReply(cid);
    return json(reply, 201);
  }
  if (path === "/v1/widget/attachments" && init.body instanceof FormData) {
    const f = init.body.get("file") as File;
    return json({ id: id("att"), filename: f.name, content_type: f.type, size_bytes: f.size, inline: false, url: URL.createObjectURL(f) }, 201);
  }
  return json({ status: 404, title: "Not found", code: "not_found" }, 404);
};

export const mockSocket: SocketFactory = () => {
  const opens: (() => void)[] = [];
  const sock: RtSocketLike = {
    connect: () => setTimeout(() => opens.forEach((f) => f()), 50),
    disconnect: () => {
      channels.length = 0;
    },
    onOpen: (cb) => opens.push(cb),
    onError: () => {},
    onClose: () => {},
    channel(topic) {
      const ch = { topic, handlers: {} as Record<string, ((p: unknown) => void)[]> };
      channels.push(ch);
      const reply = { receive: (status: string, cb: (r: unknown) => void) => (status === "ok" && setTimeout(() => cb({}), 30), reply) };
      const api: RtChannelLike = {
        join: () => reply,
        on: (event, cb) => ((ch.handlers[event] ??= []).push(cb), 0),
        push: () => reply,
        leave: () => channels.splice(channels.indexOf(ch), 1),
      };
      return api;
    },
  };
  return sock;
};
