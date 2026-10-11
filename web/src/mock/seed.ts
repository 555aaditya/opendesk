// Builds the mock database: the Fieldnote workspace (rich) and Lumen Labs (small).

import type {
  ApiKey,
  Attachment,
  AuditLog,
  Automation,
  Contact,
  KbArticle,
  KbCollection,
  Mailbox,
  Priority,
  SlaPolicy,
  Ticket,
  TicketStatus,
  User,
  Webhook,
  WebhookDelivery,
} from "@/lib/api/types";
import {
  AGENT_REPLIES,
  ARTICLES,
  COLLECTIONS,
  COMPANIES,
  FIRST,
  FOLLOW_UPS,
  GENERATED,
  LAST,
  SAVED_REPLIES,
  SPAM,
  STORIES,
  TAGS,
  TEAM,
  type TeamKey,
} from "./content";
import { contactRef, db, userRef, type WsData } from "./db";
import { teammatePresence, type Meta } from "./gateway";
import { addActivity, addMessage, computeSla, ensureTags, newTicket } from "./tickets";
import { DAY, HOUR, MIN, ago, chance, int, iso, NOW, pick, preview, reseed, shuffle, slugify, textToHtml, uuid } from "./util";

const svgData = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

function screenshotSvg(label: string, dark = false): string {
  const bg = dark ? "#171717" : "#fafafa";
  const card = dark ? "#262626" : "#ffffff";
  const line = dark ? "#3a3a3a" : "#e4e4e4";
  const ink = dark ? "#e4e4e4" : "#0a0a0a";
  const muted = dark ? "#525252" : "#d4d4d4";
  return svgData(
    `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600"><rect width="960" height="600" fill="${bg}"/><rect x="0" y="0" width="200" height="600" fill="${card}" stroke="${line}"/><rect x="24" y="28" width="110" height="12" rx="6" fill="${ink}"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="24" y="${80 + i * 34}" width="${120 - i * 9}" height="9" rx="4.5" fill="${muted}"/>`).join("")}<rect x="232" y="28" width="696" height="544" rx="12" fill="${card}" stroke="${line}"/><rect x="264" y="64" width="300" height="16" rx="8" fill="${ink}"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="264" y="${116 + i * 26}" width="${600 - (i % 3) * 120}" height="9" rx="4.5" fill="${muted}"/>`).join("")}<rect x="264" y="350" width="620" height="160" rx="8" fill="${bg}" stroke="${line}"/><text x="574" y="438" font-family="Helvetica, Arial" font-size="18" text-anchor="middle" fill="${dark ? "#8a8a8a" : "#8a8a8a"}">${label}</text></svg>`,
  );
}

function makeAttachment(kind: "screenshot" | "screenshot2" | "pdf" | "log"): Attachment {
  const a: Attachment =
    kind === "screenshot"
      ? { id: uuid(), filename: "screenshot-2026-10-11.png", content_type: "image/png", size_bytes: 284_311, inline: false, url: screenshotSvg("Sign-in redirect loop") }
      : kind === "screenshot2"
        ? { id: uuid(), filename: "export-preview.png", content_type: "image/png", size_bytes: 512_904, inline: false, url: screenshotSvg("Images missing in export", true) }
        : kind === "pdf"
          ? { id: uuid(), filename: kind === "pdf" ? "document.pdf" : "file", content_type: "application/pdf", size_bytes: 1_204_118, inline: false, url: "data:text/plain;charset=utf-8,Mock%20PDF%20attachment" }
          : { id: uuid(), filename: "crash-report.log", content_type: "text/plain", size_bytes: 48_220, inline: false, url: "data:text/plain;charset=utf-8,Thread%200%20Crashed%3A%20EXC_BAD_ACCESS" };
  db.attachments.push(a);
  return a;
}

export function baseWorkspace(id: string, name: string, slug: string): WsData {
  return {
    workspace: {
      id,
      name,
      slug,
      widget_key: `wk_${slug}_${uuid().slice(0, 8)}`,
      settings: {},
      created_at: ago(400 * DAY),
    },
    members: [],
    invitations: [],
    teams: [],
    contacts: [],
    companies: [],
    tickets: [],
    deletedTickets: new Set(),
    messages: [],
    originals: {},
    activities: [],
    tags: [],
    savedReplies: [],
    views: [],
    sla: [],
    automations: [],
    mailboxes: [],
    collections: [],
    articles: [],
    apiKeys: [],
    webhooks: [],
    deliveries: {},
    audit: [],
    notifications: [],
    widget: { greeting: "Hi there! How can we help?", require_email: false, enabled: true, allowed_origins: [] },
    events: [],
    seq: 0,
    csat: {},
    billing: defaultBilling(),
    ai: { enabled: true, auto_triage: false, auto_summarize: false, widget_answers: false, tone: "friendly", reply_language: "customer", instructions: "" },
    aiUsage: [],
  };
}

/** Self-hosted entitlements; handlers/billing.ts seeds real plans per workspace. */
export function defaultBilling(): WsData["billing"] {
  return {
    plan: "self_hosted",
    billing_enabled: false,
    status: "none",
    interval: "month",
    seats: 0,
    billed_seats: 0,
    current_period_end: null,
    cancel_at_period_end: false,
    limits: { max_mailboxes: 0, max_members: 0 },
    usage: { mailboxes: 0, members: 0 },
    credits: { unlimited: true, monthly: 0, used: 0, purchased: 0, remaining: 0, period_end: new Date(NOW + 30 * DAY).toISOString() },
    prices: { pro_month: null, pro_year: null, credit_pack: null },
  };
}

function seedUsers() {
  for (const p of TEAM) {
    const u: User = {
      id: uuid(),
      email: p.email,
      name: p.name,
      avatar_url: "",
      email_verified: true,
      totp_enabled: p.key === "jonas",
      created_at: ago(int(120, 380) * DAY),
    };
    db.users.push(u);
  }
  db.meId = db.users[0].id;
  db.sessions = [
    { id: uuid(), user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 Chrome/141.0 Safari/537.36", ip: "84.152.33.17", created_at: ago(3 * DAY), last_used_at: ago(1 * MIN), current: true },
    { id: uuid(), user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1", ip: "84.152.33.90", created_at: ago(12 * DAY), last_used_at: ago(5 * HOUR), current: false },
    { id: uuid(), user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/142.0", ip: "62.214.8.201", created_at: ago(40 * DAY), last_used_at: ago(9 * DAY), current: false },
  ];
}

const uid = (k: TeamKey) => db.users[TEAM.findIndex((t) => t.key === k)].id;

function seedFieldnote(): WsData {
  const ws = baseWorkspace(uuid(), "Fieldnote", "fieldnote");
  ws.workspace.settings = {
    timezone: "Europe/Berlin",
    help_center_enabled: true,
    help_center_title: "Fieldnote Help",
    csat_enabled: true,
    auto_assign: "round_robin",
  };
  ws.widget = { greeting: "Hi! Ask us anything about Fieldnote.", require_email: true, enabled: true, allowed_origins: ["https://fieldnote.app", "https://www.fieldnote.app"] };

  TEAM.forEach((p, i) => ws.members.push({ user_id: db.users[i].id, role: p.role, created_at: ago((380 - i * 40) * DAY) }));
  ws.teams = [
    { id: uuid(), name: "Support", member_ids: [uid("maya"), uid("jonas"), uid("priya"), uid("sam")], created_at: ago(300 * DAY) },
    { id: uuid(), name: "Billing", member_ids: [uid("lea"), uid("maya")], created_at: ago(280 * DAY) },
  ];
  const teamId = (n: "Support" | "Billing" | null) => (n ? ws.teams.find((t) => t.name === n)!.id : null);

  ws.invitations = [
    { id: uuid(), token: "inv_demo", email: "rafael@fieldnote.app", role: "agent", expires_at: iso(NOW + 5 * DAY), created_at: ago(2 * DAY), invited_by: userRef(uid("maya")) },
    { id: uuid(), token: "inv_demo2", email: "noor@fieldnote.app", role: "admin", expires_at: iso(NOW + 6 * DAY), created_at: ago(1 * DAY), invited_by: userRef(uid("jonas")) },
  ];

  // Tags, SLA, mailboxes.
  ensureTags(ws, [...TAGS], false);
  const sla: SlaPolicy[] = [
    { id: uuid(), name: "Urgent", priority: "urgent", first_response_minutes: 60, resolution_minutes: 8 * 60, enabled: true, position: 0 },
    { id: uuid(), name: "High priority", priority: "high", first_response_minutes: 2 * 60, resolution_minutes: 24 * 60, enabled: true, position: 1 },
    { id: uuid(), name: "Standard", priority: null, first_response_minutes: 8 * 60, resolution_minutes: 3 * 24 * 60, enabled: true, position: 2 },
  ];
  ws.sla = sla;

  const mbBase = { signature_html: "", auto_reply_enabled: false, auto_reply_subject: "", auto_reply_html: "", last_error: "", team_id: null as string | null };
  const support: Mailbox = {
    ...mbBase,
    id: uuid(),
    name: "Support",
    email: "support@fieldnote.app",
    display_name: "Fieldnote Support",
    inbound_kind: "google",
    outbound_kind: "google",
    forwarding_address: "fieldnote-support-2m9q@in.opendesk.sh",
    config: { oauth_email: "support@fieldnote.app" },
    team_id: teamId("Support"),
    signature_html: "<p>{{agent.first_name}} from Fieldnote<br>fieldnote.app</p>",
    auto_reply_enabled: true,
    auto_reply_subject: "We got your message",
    auto_reply_html: "<p>Thanks for writing in. We usually reply within a few hours on weekdays.</p>",
    status: "active",
    last_synced_at: ago(40 * 1000),
    created_at: ago(300 * DAY),
  };
  const billing: Mailbox = {
    ...mbBase,
    id: uuid(),
    name: "Billing",
    email: "billing@fieldnote.app",
    display_name: "Fieldnote Billing",
    inbound_kind: "forwarding",
    outbound_kind: "system",
    forwarding_address: "fieldnote-billing-7f3k@in.opendesk.sh",
    config: {},
    team_id: teamId("Billing"),
    status: "active",
    last_synced_at: ago(12 * MIN),
    created_at: ago(260 * DAY),
  };
  const partners: Mailbox = {
    ...mbBase,
    id: uuid(),
    name: "Partners",
    email: "partners@fieldnote.app",
    display_name: "Fieldnote Partnerships",
    inbound_kind: "imap",
    outbound_kind: "smtp",
    forwarding_address: "fieldnote-partners-q81z@in.opendesk.sh",
    config: { imap_host: "imap.fastmail.com", imap_port: 993, imap_username: "partners@fieldnote.app", imap_tls: "tls", smtp_host: "smtp.fastmail.com", smtp_port: 465, smtp_username: "partners@fieldnote.app", smtp_tls: "tls" },
    status: "error",
    last_error: "IMAP login failed: [AUTHENTICATIONFAILED] Invalid credentials",
    last_synced_at: ago(2 * DAY),
    created_at: ago(90 * DAY),
  };
  ws.mailboxes = [support, billing, partners];

  // Companies and contacts.
  ws.companies = COMPANIES.map((c, i) => ({
    id: uuid(),
    name: c.name,
    domain: c.domain,
    notes: c.notes,
    custom: { plan: ["Enterprise", "Business", "Team", "Startup"][i % 4] },
    contact_count: 0,
    created_at: ago((200 - i * 9) * DAY),
    updated_at: ago(int(1, 30) * DAY),
  }));
  const fixed: [string, number | null][] = [
    ["Dana Whitfield", 3],
    ["Kofi Mensah", 0],
    ["Marcus Lindqvist", 0],
    ["Tomás García", 2],
    ["Elena Rossi", 1],
    ["Hugo Moreau", 5],
    ["Chloé Dubois", 4],
    ["Ben Hartmann", 7],
    ["Freya Nilsen", 8],
    ["Gabriel Laurent", 6],
    ["Aisha Bello", 10],
    ["Isaac Levy", 9],
    ["Julia Novak", 11],
  ];
  const people: [string, number | null][] = [...fixed];
  for (let i = 13; i < 45; i++) people.push([`${FIRST[i]} ${LAST[(i * 7) % LAST.length]}`, chance(0.72) ? int(0, COMPANIES.length - 1) : null]);
  const personal = ["gmail.com", "outlook.com", "proton.me", "icloud.com", "fastmail.com"];
  ws.contacts = people.map(([name, ci], i): Contact => {
    const company = ci === null ? null : ws.companies[ci];
    const local = slugify(name.normalize("NFD").replace(/[̀-ͯ]/g, "")).replace(/-/g, ".");
    const email = `${company ? local.split(".")[0] : local}@${company ? company.domain : pick(personal)}`;
    if (company) company.contact_count++;
    return {
      id: uuid(),
      email,
      name,
      phone: chance(0.4) ? `+49 30 ${int(1000000, 9999999)}` : "",
      avatar_url: "",
      company: company ? { id: company.id, name: company.name, domain: company.domain } : null,
      external_id: chance(0.5) ? `usr_${int(10000, 99999)}` : null,
      notes: i === 0 ? "IT lead. Prefers email, very responsive. Escalate SSO issues to Jonas." : "",
      custom: chance(0.5) ? { plan: pick(["Team", "Business", "Enterprise"]), seats: int(3, 240) } : {},
      blocked: false,
      ticket_count: 0,
      created_at: ago(int(20, 300) * DAY),
      updated_at: ago(int(1, 20) * DAY),
    };
  });

  const mention = (html: string) => html.replace(/@@(\w+)/g, (_m, k: string) => uid(k as TeamKey));

  // Story tickets.
  for (const s of STORIES) {
    const c = ws.contacts[s.contact];
    const first = s.thread[0];
    const t = newTicket(ws, {
      subject: s.subject,
      contact: contactRef(c),
      channel: s.channel,
      priority: s.priority,
      mailbox_id: s.mailbox === "billing" ? billing.id : support.id,
      assignee: s.assignee ? userRef(uid(s.assignee)) : null,
      team_id: teamId(s.team),
      tags: ensureTags(ws, s.tags, false),
      created_at: ago(first.min * MIN),
    });
    t.number = s.number;
    seedActivities(ws, t, s.assignee ? uid(s.assignee) : null, s.tags);
    for (const m of s.thread) {
      addMessage(
        ws,
        t,
        {
          kind: m.note ? "note" : "reply",
          direction: m.from === "c" ? "inbound" : "outbound",
          html: mention(m.html),
          user: m.from === "c" ? null : userRef(uid(m.from)),
          attachments: (m.attach ?? []).map(makeAttachment),
          at: ago(m.min * MIN),
          has_quoted: m.quoted,
          delivery: m.delivery,
        },
        { publish: false },
      );
    }
    finalize(ws, t, s.status, s.csat);
  }

  // Generated tickets.
  const statuses: TicketStatus[] = shuffle([
    ...Array<TicketStatus>(23).fill("open"),
    ...Array<TicketStatus>(10).fill("pending"),
    ...Array<TicketStatus>(2).fill("on_hold"),
    ...Array<TicketStatus>(18).fill("solved"),
    ...Array<TicketStatus>(3).fill("closed"),
  ]);
  const agents: TeamKey[] = ["maya", "jonas", "priya", "sam", "lea"];
  const gen = GENERATED.slice(0, statuses.length);
  gen.forEach((g, i) => {
    const status = statuses[i];
    const c = ws.contacts[(i * 5 + 13) % ws.contacts.length];
    const openish = status === "open" || status === "pending" || status === "on_hold";
    const createdMin = openish ? int(60, 6 * 24 * 60) : int(2 * 24 * 60, 30 * 24 * 60);
    const priority: Priority = pick(["low", "normal", "normal", "normal", "high", "high", "urgent"]);
    const assignee: TeamKey | null = status === "open" && chance(0.45) ? null : pick(agents);
    const isBilling = g.tags.includes("billing");
    const t = newTicket(ws, {
      subject: g.subject,
      contact: contactRef(c),
      channel: chance(0.12) ? "chat" : chance(0.05) ? "portal" : "email",
      priority,
      mailbox_id: isBilling ? billing.id : support.id,
      assignee: assignee ? userRef(uid(assignee)) : null,
      team_id: isBilling ? teamId("Billing") : chance(0.7) ? teamId("Support") : null,
      tags: ensureTags(ws, g.tags, false),
      created_at: ago(createdMin * MIN),
    });
    seedActivities(ws, t, assignee ? uid(assignee) : null, g.tags);
    const msgs: { dir: "inbound" | "outbound"; note?: boolean; html: string }[] = [{ dir: "inbound", html: textToHtml(`Hi,\n\n${g.body}\n\nThanks,\n${c.name.split(" ")[0]}`) }];
    const replier = assignee ?? "sam";
    const agentHtml = () => textToHtml(`Hi ${c.name.split(" ")[0]},\n\n${pick(AGENT_REPLIES)}\n\n${TEAM.find((x) => x.key === replier)!.name.split(" ")[0]}`);
    if (status === "open") {
      if (chance(0.5)) {
        msgs.push({ dir: "outbound", html: agentHtml() });
        msgs.push({ dir: "inbound", html: textToHtml(pick(FOLLOW_UPS)) });
      }
    } else {
      msgs.push({ dir: "outbound", html: agentHtml() });
      if (status === "solved" || status === "closed") {
        if (chance(0.6)) msgs.push({ dir: "inbound", html: textToHtml(pick(["Thanks, that worked!", "Great, appreciate the quick reply.", "All sorted now, thank you."])) });
      }
    }
    if (chance(0.25)) msgs.splice(1, 0, { dir: "outbound", note: true, html: `<p>${pick(["Looks related to the sync issue from last week.", "Customer is on the Business plan, prioritize.", "Checked the logs, nothing unusual on our side yet.", "Same as #1018, linking."])}</p>` });
    const span = Math.max(createdMin - (openish ? int(5, Math.min(createdMin - 1, 2 * 24 * 60)) : int(60, 24 * 60)), 1);
    msgs.forEach((m, j) => {
      const at = ago((createdMin - (span * j) / Math.max(msgs.length - 1, 1)) * MIN);
      addMessage(
        ws,
        t,
        { kind: m.note ? "note" : "reply", direction: m.dir, html: m.html, user: m.dir === "outbound" ? userRef(uid(replier)) : null, at },
        { publish: false },
      );
    });
    finalize(ws, t, status, status === "solved" && chance(0.5) ? { score: pick([5, 5, 4, 4, 3, 2]), comment: pick(["", "Fast and friendly.", "Took a while but solved.", ""]) } : undefined);
    if (chance(0.22) && t.priority !== "urgent") t.sla = null;
  });

  // Make one generated open, unassigned, high ticket close to its first-response deadline.
  const dueSoon = ws.tickets.find((t) => t.status === "open" && !t.assignee && t.number < 1061 && !t.first_responded_at);
  if (dueSoon) {
    dueSoon.priority = "high";
    const created = NOW - 100 * MIN;
    dueSoon.created_at = iso(created);
    for (const m of ws.messages.filter((x) => x.ticket_id === dueSoon.id)) m.created_at = iso(created);
    dueSoon.last_message_at = iso(created);
    dueSoon.last_customer_message_at = iso(created);
    dueSoon.sla = computeSla(ws, dueSoon, false);
  }

  // Spam.
  for (const s of SPAM) {
    const t = newTicket(ws, {
      subject: s.subject,
      contact: { id: uuid(), email: s.from, name: s.name, avatar_url: "" },
      channel: "email",
      priority: "low",
      mailbox_id: support.id,
      created_at: ago(int(60, 3 * 24 * 60) * MIN),
    });
    addMessage(ws, t, { kind: "reply", direction: "inbound", html: textToHtml(s.body), at: t.created_at }, { publish: false });
    t.spam = true;
    t.sla = null;
  }

  // Number tickets by creation for everything that isn't a story.
  const storyNumbers = new Set(STORIES.map((s) => s.number));
  let n = 1001;
  for (const t of ws.tickets.filter((x) => !storyNumbers.has(x.number)).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    while (storyNumbers.has(n)) n++;
    t.number = n++;
  }
  for (const c of ws.contacts) c.ticket_count = ws.tickets.filter((t) => t.contact?.id === c.id).length;

  // Keep breaches rare and meaningful: a few overdue open tickets, not half the inbox.
  let breachedKept = 0;
  for (const t of ws.tickets) {
    if (!t.sla?.breached || storyNumbers.has(t.number)) continue;
    const openish = t.status === "open" || t.status === "pending" || t.status === "on_hold";
    if (openish && breachedKept < 3) {
      breachedKept++;
      continue;
    }
    if (openish) t.sla = null;
    else t.sla.breached = false;
    ws.activities = ws.activities.filter((a) => !(a.ticket_id === t.id && a.type === "sla_breached"));
  }

  // Saved replies, views, automations.
  ws.savedReplies = SAVED_REPLIES.map((r, i) => ({ id: uuid(), title: r.title, shortcut: r.shortcut, body_html: r.body, created_at: ago((100 - i) * DAY), updated_at: ago(int(1, 30) * DAY) }));
  ws.views = [
    { id: uuid(), name: "Urgent", shared: true, filters: { status: ["open", "pending"], priority: ["urgent", "high"] }, position: 0 },
    { id: uuid(), name: "Billing queue", shared: true, filters: { status: ["open", "pending", "on_hold"], team_id: teamId("Billing")! }, position: 1 },
    { id: uuid(), name: "Waiting on engineering", shared: false, filters: { status: ["on_hold", "pending"], tag: "bug" }, position: 2 },
  ];
  const tagName = (n: string) => n;
  const autos: Automation[] = [
    {
      id: uuid(),
      name: "Route billing mail to the Billing team",
      trigger: "ticket_created",
      conditions: [{ field: "mailbox_id", op: "equals", value: billing.id }],
      actions: [{ type: "assign_team", value: teamId("Billing")! }, { type: "add_tag", value: tagName("billing") }],
      enabled: true,
      position: 0,
      run_count: 412,
    },
    {
      id: uuid(),
      name: "Escalate SSO outages",
      trigger: "ticket_created",
      conditions: [{ field: "subject", op: "contains", value: "SSO" }, { field: "body", op: "contains", value: "can't sign in" }],
      actions: [{ type: "set_priority", value: "urgent" }, { type: "add_tag", value: "sso" }, { type: "assign_user", value: uid("jonas") }],
      enabled: true,
      position: 1,
      run_count: 37,
    },
    {
      id: uuid(),
      name: "Reopen on customer reply",
      trigger: "customer_replied",
      conditions: [{ field: "status", op: "equals", value: "pending" }],
      actions: [{ type: "set_status", value: "open" }],
      enabled: true,
      position: 2,
      run_count: 1290,
    },
    {
      id: uuid(),
      name: "Mark gift card mail as spam",
      trigger: "ticket_created",
      conditions: [{ field: "subject", op: "contains", value: "gift card" }],
      actions: [{ type: "mark_spam", value: "true" }],
      enabled: false,
      position: 3,
      run_count: 8,
    },
  ];
  ws.automations = autos;

  // Knowledge base.
  ws.collections = COLLECTIONS.map((c, i): KbCollection => ({ id: uuid(), name: c.name, slug: c.slug, description: c.description, position: i, article_count: 0 }));
  ws.articles = ARTICLES.map((a, i): KbArticle => {
    const col = ws.collections[a.collection];
    col.article_count++;
    const updated = ago(int(1, 60) * DAY);
    return {
      id: uuid(),
      collection_id: col.id,
      title: a.title,
      slug: slugify(a.title),
      excerpt: a.excerpt,
      body_html: a.body,
      status: a.status,
      author: userRef(uid(pick(["maya", "jonas", "priya"] as const))),
      views: a.views,
      published_at: a.status === "published" ? ago((90 - i * 4) * DAY) : null,
      updated_at: updated,
    };
  });

  // API keys and webhooks.
  const keys: ApiKey[] = [
    { id: uuid(), name: "Zapier", prefix: "od_live_Zq4kP2mA", scopes: ["tickets:read", "tickets:write", "contacts:read"], last_used_at: ago(3 * MIN), expires_at: null, created_at: ago(120 * DAY), created_by: userRef(uid("maya")) },
    { id: uuid(), name: "Data warehouse export", prefix: "od_live_8sTnW7cE", scopes: ["tickets:read", "contacts:read", "kb:read"], last_used_at: ago(9 * HOUR), expires_at: iso(NOW + 60 * DAY), created_at: ago(45 * DAY), created_by: userRef(uid("jonas")) },
  ];
  ws.apiKeys = keys;
  const hooks: Webhook[] = [
    { id: uuid(), url: "https://hooks.fieldnote.app/opendesk", description: "Internal event bus", events: ["ticket.created", "ticket.updated", "message.created"], enabled: true, created_at: ago(100 * DAY) },
    { id: uuid(), url: "https://hooks.slack.com/services/T0001/B0002/XXXX", description: "Urgent tickets to #support-alerts", events: ["ticket.created"], enabled: true, created_at: ago(30 * DAY) },
  ];
  ws.webhooks = hooks;
  for (const h of hooks) {
    const list: WebhookDelivery[] = [];
    for (let i = 0; i < (h === hooks[0] ? 14 : 8); i++) {
      const failed = chance(0.2);
      list.push({
        id: uuid(),
        event_id: uuid(),
        event_type: pick(h.events),
        status: i === 0 && h === hooks[1] ? "pending" : failed ? "failed" : "succeeded",
        attempts: failed ? int(2, 6) : 1,
        response_code: failed ? pick([500, 502, 504, 410]) : 200,
        duration_ms: int(40, 900),
        created_at: ago((i * 47 + int(1, 30)) * MIN),
      });
    }
    ws.deliveries[h.id] = list;
  }

  // Audit log.
  const actions: [string, string, () => Record<string, unknown>][] = [
    ["auth.login", "user", () => ({})],
    ["auth.login_failed", "user", () => ({ reason: "invalid_credentials" })],
    ["member.invited", "invitation", () => ({ email: "rafael@fieldnote.app", role: "agent" })],
    ["member.role_changed", "member", () => ({ from: "agent", to: "admin" })],
    ["api_key.created", "api_key", () => ({ name: "Zapier" })],
    ["webhook.created", "webhook", () => ({ url: "https://hooks.fieldnote.app/opendesk" })],
    ["mailbox.connected", "mailbox", () => ({ email: "support@fieldnote.app", kind: "google" })],
    ["mailbox.disconnected", "mailbox", () => ({ email: "sales@fieldnote.app" })],
    ["auth.totp_enabled", "user", () => ({})],
    ["auth.password_changed", "user", () => ({})],
    ["workspace.updated", "workspace", () => ({ fields: ["settings.csat_enabled"] })],
    ["automation.updated", "automation", () => ({ name: "Escalate SSO outages" })],
    ["sla_policy.created", "sla_policy", () => ({ name: "Urgent" })],
    ["member.removed", "member", () => ({ email: "alex@fieldnote.app" })],
  ];
  const ips = ["84.152.33.17", "62.214.8.201", "91.64.120.5", "185.12.44.9", "2a02:8109:9a40::1c"];
  const audit: AuditLog[] = [];
  for (let i = 0; i < 42; i++) {
    const [action, entity, data] = pick(actions);
    const actorUser = pick(["maya", "jonas", "maya", "lea", "priya"] as const);
    const viaKey = action.startsWith("ticket") ? keys[0].id : null;
    audit.push({
      id: uuid(),
      actor: viaKey ? { type: "api_key", user: null, api_key_id: viaKey } : i % 13 === 7 ? { type: "system", user: null, api_key_id: null } : { type: "user", user: userRef(uid(actorUser)), api_key_id: null },
      action,
      entity_type: entity,
      entity_id: uuid(),
      data: data(),
      ip: pick(ips),
      created_at: ago((i * 173 + int(1, 120)) * MIN),
    });
  }
  ws.audit = audit;

  // Notifications for Maya.
  const byNum = (n: number) => ws.tickets.find((t) => t.number === n)!;
  const nref = (t: Ticket) => ({ id: t.id, number: t.number, subject: t.subject });
  const jonas = userRef(uid("jonas"));
  ws.notifications = [
    { id: uuid(), type: "customer_replied", ticket: nref(byNum(1072)), data: { contact: { name: "Dana Whitfield" } }, read_at: null, created_at: ago(6 * MIN) },
    { id: uuid(), type: "mentioned", ticket: nref(byNum(1072)), data: { actor: jonas }, read_at: null, created_at: ago(61 * MIN) },
    { id: uuid(), type: "customer_replied", ticket: nref(byNum(1068)), data: { contact: { name: "Tomás García" } }, read_at: null, created_at: ago(35 * MIN) },
    { id: uuid(), type: "sla_breached", ticket: nref(byNum(1067)), data: { kind: "first_response" }, read_at: null, created_at: ago(2 * HOUR) },
    { id: uuid(), type: "assigned", ticket: nref(byNum(1062)), data: { actor: jonas }, read_at: ago(8 * HOUR), created_at: ago(9 * HOUR) },
    { id: uuid(), type: "assigned", ticket: nref(byNum(1068)), data: { actor: null }, read_at: ago(4 * HOUR), created_at: ago(5 * HOUR) },
    { id: uuid(), type: "mentioned", ticket: nref(byNum(1070)), data: { actor: userRef(uid("lea")) }, read_at: ago(20 * HOUR), created_at: ago(25 * HOUR) },
    { id: uuid(), type: "customer_replied", ticket: nref(byNum(1063)), data: { contact: { name: "Hugo Moreau" } }, read_at: ago(60 * HOUR), created_at: ago(68 * HOUR) },
  ];

  ws.csat.demo = { ticket_id: byNum(1066).id, score: null, comment: "" };

  // Teammates present on tickets.
  const meta = (k: TeamKey, state: Meta["state"]): Omit<Meta, "phx_ref" | "online_at"> => ({ user_id: uid(k), name: TEAM.find((x) => x.key === k)!.name, avatar: "", state });
  const unassigned = ws.tickets
    .filter((t) => !t.spam && !t.assignee && ["open", "pending", "on_hold"].includes(t.status))
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
  const place = (t: Ticket | undefined, m: Omit<Meta, "phx_ref" | "online_at">) => {
    if (!t) return;
    const list = teammatePresence.get(t.id) ?? [];
    list.push({ ...m, online_at: ago(int(1, 20) * MIN), phx_ref: `seed${list.length}${m.user_id.slice(0, 4)}` });
    teammatePresence.set(t.id, list);
  };
  place(unassigned[1], meta("jonas", "viewing"));
  place(byNum(1072), meta("priya", "replying"));
  place(unassigned[3], meta("sam", "viewing"));
  place(byNum(1068), meta("lea", "viewing"));

  return ws;
}

function seedActivities(ws: WsData, t: Ticket, assigneeId: string | null, tags: string[]) {
  const created = Date.parse(t.created_at);
  for (const tag of tags) addActivity(ws, t, "tagged", { tag }, null, iso(created + 30_000), false);
  if (assigneeId) addActivity(ws, t, "assigned", { from: null, to: userRef(assigneeId) }, null, iso(created + 60_000), false);
}

function finalize(ws: WsData, t: Ticket, status: TicketStatus, csat?: { score: number; comment: string }) {
  const lastAt = Date.parse(t.last_message_at);
  if (status !== "open") {
    addActivity(ws, t, "status_changed", { from: "open", to: status }, t.assignee, iso(lastAt + 60_000), false);
  }
  t.status = status;
  if (status === "solved" || status === "closed") t.solved_at = iso(lastAt + 60_000);
  if (t.priority === "urgent" && t.number % 2 === 0) {
    addActivity(ws, t, "priority_changed", { from: "high", to: "urgent" }, t.assignee, iso(Date.parse(t.created_at) + 5 * MIN), false);
  }
  t.sla = computeSla(ws, t, false);
  if (t.sla?.breached && status === "open") {
    const due = t.first_responded_at ? t.sla.resolution_due_at : t.sla.first_response_due_at;
    addActivity(ws, t, "sla_breached", { kind: t.first_responded_at ? "resolution" : "first_response" }, null, due ?? t.created_at, false);
  }
  if (csat) {
    t.csat = csat;
    addActivity(ws, t, "csat_received", { score: csat.score, comment: csat.comment }, null, iso(lastAt + 3 * HOUR), false);
  }
  t.updated_at = t.last_message_at;
  t.last_message_preview = t.last_message_preview || preview(ws.messages.find((m) => m.ticket_id === t.id)?.body_html ?? "");
}

function seedLumen(): WsData {
  const ws = baseWorkspace(uuid(), "Lumen Labs", "lumen");
  ws.workspace.settings = { timezone: "America/New_York", help_center_enabled: false, csat_enabled: false, auto_assign: "none", locale: "de" };
  ws.members = [
    { user_id: db.users[0].id, role: "agent", created_at: ago(60 * DAY) },
    { user_id: db.users[3].id, role: "owner", created_at: ago(200 * DAY) },
  ];
  ws.sla = [{ id: uuid(), name: "Default", priority: null, first_response_minutes: 240, resolution_minutes: 2880, enabled: true, position: 0 }];
  ensureTags(ws, ["question", "bug"], false);
  ws.mailboxes = [
    {
      id: uuid(),
      name: "Hello",
      email: "hello@lumenlabs.io",
      display_name: "Lumen Labs",
      inbound_kind: "forwarding",
      outbound_kind: "system",
      forwarding_address: "lumen-hello-a1b2@in.opendesk.sh",
      config: {},
      team_id: null,
      signature_html: "",
      auto_reply_enabled: false,
      auto_reply_subject: "",
      auto_reply_html: "",
      status: "active",
      last_error: "",
      last_synced_at: ago(3 * MIN),
      created_at: ago(200 * DAY),
    },
  ];
  const names = ["Avery Stone", "Jordan Blake", "Riley Chen", "Morgan Diaz"];
  ws.contacts = names.map((name) => ({
    id: uuid(),
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    name,
    phone: "",
    avatar_url: "",
    company: null,
    external_id: null,
    notes: "",
    custom: {},
    blocked: false,
    ticket_count: 1,
    created_at: ago(30 * DAY),
    updated_at: ago(3 * DAY),
  }));
  const subjects = ["Lamp firmware update stuck at 80%", "Where can I buy replacement bulbs?", "App can't find my lamp", "Order #4410 hasn't shipped"];
  subjects.forEach((subject, i) => {
    const t = newTicket(ws, { subject, contact: contactRef(ws.contacts[i]), channel: "email", created_at: ago((i + 1) * 7 * HOUR), mailbox_id: ws.mailboxes[0].id });
    t.number = 201 + i;
    addMessage(ws, t, { kind: "reply", direction: "inbound", html: textToHtml(`Hello,\n\n${subject}. Can you help?`), at: t.created_at }, { publish: false });
    if (i === 3) t.status = "pending";
  });
  return ws;
}

export function seed() {
  reseed(0x2f6e2b1);
  seedUsers();
  db.workspaces = [seedFieldnote(), seedLumen()];
}
