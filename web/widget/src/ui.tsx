import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Fragment, type JSX } from "preact";
import { NEW, type Controller } from "./controller";
import { handedOff, handoffTarget, isAiAnswer, sourcesOf } from "./ai";
import { initials, safeHtml, size } from "./html";
import { clock, current, dayLabel, isRtl, relTime, t } from "./i18n";
import { useStore } from "./store";
import type { Attachment, UiMessage } from "./types";

// ── Icons (16px line set, currentColor) ──────────────────────────────────────

const Mark = () => (
  <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
    <path
      fill="currentColor"
      fill-rule="evenodd"
      d="M11 4h12a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-12a7 7 0 0 1-7-7v-12a7 7 0 0 1 7-7Z M47 4a13 13 0 1 1 0 26a13 13 0 1 1 0-26Z M11 34h12a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-12a7 7 0 0 1-7-7v-12a7 7 0 0 1 7-7Z M41 34h12a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-12a7 7 0 0 1-7-7v-12a7 7 0 0 1 7-7Z"
    />
  </svg>
);
const svg = (d: JSX.Element, s = 16) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const X = (s = 16) => svg(<path d="M18 6 6 18M6 6l12 12" />, s);
const Back = () => svg(<path d="m15 18-6-6 6-6" />);
const Clip = () => svg(<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />);
const Up = () => svg(<path d="M12 19V5M5 12l7-7 7 7" />);
const Ext = () => svg(<path d="M7 17 17 7M8 7h9v9" />, 14);
const FileIc = () => svg(<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />, 14);
const Sparkle = (s = 12) => svg(<path d="M12 3c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7ZM19 15.5c.2 1.8.9 2.5 2.5 2.7-1.6.2-2.3.9-2.5 2.7-.2-1.8-.9-2.5-2.5-2.7 1.6-.2 2.3-.9 2.5-2.7Z" />, s);
const Person = () => svg(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>, 14);
const Check = () => svg(<path d="M20 6 9 17l-5-5" />, 14);

// ── Root ─────────────────────────────────────────────────────────────────────

export function App({ c }: { c: Controller }) {
  const s = useStore();
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const [live, setLive] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    c.announce = setLive;
  }, [c]);

  // Focus moves into the panel when it opens and back to the launcher when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (s.open && !wasOpen.current) {
      requestAnimationFrame(() => {
        const p = panel.current;
        const t = p?.querySelector<HTMLElement>("textarea:not(:disabled)") ?? p?.querySelector<HTMLElement>(".primary:not(:disabled)") ?? p?.querySelector<HTMLElement>("button");
        t?.focus({ preventScroll: true });
      });
    } else if (!s.open && wasOpen.current) launcher.current?.focus();
    wasOpen.current = s.open;
  }, [s.open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      c.close();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, input, a[href]"));
    if (!items.length) return;
    const root = panel.current.getRootNode() as ShadowRoot;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && root.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && root.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list).slice(0, 5);
    if (!arr.length) return;
    if (s.view !== "thread") c.newConversation();
    setFiles((f) => [...f, ...arr].slice(0, 5));
  };

  return (
    <div class="root" dir={isRtl(s.lang) ? "rtl" : "ltr"} lang={current()}>
      <div class="sr" aria-live="polite">
        {live}
      </div>
      {s.open && (
        <div
          ref={panel}
          class="panel"
          role="dialog"
          aria-label={t("chatWith", { name: s.config?.workspace_name ?? t("support") })}
          onKeyDown={onKey}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes("Files")) {
              e.preventDefault();
              setDrag(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.target === panel.current) setDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles(e.dataTransfer?.files ?? null);
          }}
        >
          {s.view === "home" ? <Home c={c} /> : <Thread c={c} files={files} setFiles={setFiles} addFiles={addFiles} />}
          {drag && <div class="drop">{t("dropFiles")}</div>}
        </div>
      )}
      <button
        ref={launcher}
        class={`launcher${s.open ? " hide-mobile" : ""}`}
        aria-label={s.open ? t("closeChat") : s.unread ? t("openChatUnread", { count: s.unread }) : t("openChat")}
        aria-expanded={s.open}
        onClick={() => c.toggle()}
      >
        <span class="ic ic-mark">
          <Mark />
        </span>
        <span class="ic ic-x">{X(22)}</span>
        {!s.open && s.unread > 0 && <span class="badge">{s.unread > 9 ? "9+" : s.unread}</span>}
      </button>
    </div>
  );
}

// ── Home: greeting and conversations ─────────────────────────────────────────

function Home({ c }: { c: Controller }) {
  const s = useStore();
  const name = s.config?.workspace_name ?? t("support");
  const convs = s.conversations;
  return (
    <>
      <div class="head home">
        <div class="head-main">
          <div class="ws">
            <span class="ws-glyph" aria-hidden="true">
              {name.charAt(0).toUpperCase()}
            </span>
            {name}
          </div>
          <div class="greet">{greeting(s.config?.greeting)}</div>
          <div class="sub">{t("replyTime")}</div>
        </div>
        <button class="icon-btn" aria-label={t("closeChat")} onClick={() => c.close()}>
          {X()}
        </button>
      </div>
      <div class="body">
        <div class="home-body">
          {s.error && !s.session ? (
            <div class="empty">
              <b>{t("unavailable")}</b>
              {t("unavailableHint")}
            </div>
          ) : (
            <button class="primary" disabled={!s.session} onClick={() => c.newConversation()}>
              {t("sendMessage")}
            </button>
          )}
          {convs === null ? (
            s.booting && (
              <div class="card" aria-busy="true">
                <div class="skel" style={{ width: "40%" }} />
                <div class="skel" style={{ width: "75%" }} />
              </div>
            )
          ) : convs.length > 0 ? (
            <div class="card">
              <div class="card-h">{t("yourConversations")}</div>
              {convs.slice(0, 6).map((v) => (
                <button key={v.id} class="conv" onClick={() => void c.openConversation(v.id)}>
                  <span class={`dot${v.status === "solved" || v.status === "closed" ? "" : " open"}`} aria-hidden="true" />
                  <span class="conv-main">
                    <span class="conv-top">
                      <span class="conv-subject">{v.subject || t("conversation")}</span>
                      <span class="time">{relTime(v.last_message_at)}</span>
                    </span>
                    <span class="conv-prev" style={{ display: "block" }}>
                      {s.typing[v.id] ? t("typing", { name: s.typing[v.id] }) : v.last_message_preview}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {s.config?.help_center_url && (
            <div class="card">
              <a class="link-row" href={s.config.help_center_url} target="_blank" rel="noopener noreferrer">
                {t("searchHelp")}
                <span class="flip">
                  <Ext />
                </span>
              </a>
            </div>
          )}
        </div>
      </div>
      <a class="foot" href="https://opendesk.sh" target="_blank" rel="noopener noreferrer">
        <svg width="10" height="10" viewBox="0 0 64 64" aria-hidden="true">
          <path fill="currentColor" d="M11 4h12a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-12a7 7 0 0 1-7-7v-12a7 7 0 0 1 7-7Z M47 4a13 13 0 1 1 0 26a13 13 0 1 1 0-26Z M11 34h12a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-12a7 7 0 0 1-7-7v-12a7 7 0 0 1 7-7Z M41 34h12a7 7 0 0 1 7 7v12a7 7 0 0 1-7 7h-12a7 7 0 0 1-7-7v-12a7 7 0 0 1 7-7Z" />
        </svg>
        {t("poweredBy")}
      </a>
    </>
  );
}

// ── Thread ───────────────────────────────────────────────────────────────────

function Thread({
  c,
  files,
  setFiles,
  addFiles,
}: {
  c: Controller;
  files: File[];
  setFiles: (f: File[]) => void;
  addFiles: (f: FileList | null) => void;
}) {
  const s = useStore();
  const key = s.active ?? NEW;
  const msgs = s.messages[key];
  const conv = s.conversations?.find((v) => v.id === s.active);
  const typing = s.active ? s.typing[s.active] : undefined;
  const scroller = useRef<HTMLDivElement>(null);
  const needsEmail = c.needsEmail();
  const target = msgs ? handoffTarget(msgs) : null;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs?.length, typing]);

  return (
    <>
      <div class="head">
        <button class="icon-btn flip" aria-label={t("back")} onClick={() => c.home()}>
          <Back />
        </button>
        <div class="head-main" style={{ paddingTop: "1px" }}>
          <div class="title">{conv?.subject || (s.active ? t("conversation") : t("newConversation"))}</div>
          <div class="title-sub">{s.config?.workspace_name ?? t("support")}</div>
        </div>
        <button class="icon-btn" aria-label={t("closeChat")} onClick={() => c.close()}>
          {X()}
        </button>
      </div>
      <div class="body" ref={scroller}>
        {needsEmail && <Capture c={c} />}
        {msgs === undefined ? (
          <div aria-busy="true" style={{ paddingTop: "12px" }}>
            <div class="skel" style={{ width: "55%" }} />
            <div class="skel" style={{ width: "35%", marginInlineStart: "auto" }} />
          </div>
        ) : msgs.length === 0 && !needsEmail ? (
          <div class="empty">
            <b>{greeting(s.config?.greeting)}</b>
            {t("emptyHint")}
          </div>
        ) : (
          <div class="thread">
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const me = m.direction === "inbound";
              const ai = isAiAnswer(m);
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              const grouped =
                !!prev &&
                !newDay &&
                !ai &&
                !isAiAnswer(prev) &&
                prev.direction === m.direction &&
                prev.author.type === m.author.type &&
                prev.author.user?.id === m.author.user?.id &&
                Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60_000;
              const done = handedOff(conv) || (!!s.active && s.handoff[s.active] === "done");
              const offer = ai && s.active && m.id === target?.id ? (done ? "done" : target.answered ? null : (s.handoff[s.active] ?? "idle")) : null;
              return (
                <Fragment key={m.id}>
                  {newDay && <div class="day">{dayLabel(m.created_at)}</div>}
                  {ai ? (
                    <AiBubble m={m} name={s.config?.workspace_name ?? t("support")} offer={offer} onHandoff={() => s.active && void c.handoff(s.active)} />
                  ) : (
                    <Bubble m={m} me={me} grouped={grouped} onRetry={() => void c.retry(key, m.id)} />
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
        {typing && (
          <div class="typing" style={{ padding: "0 14px 10px" }} aria-label={t("typing", { name: typing })}>
            <span class="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {typing}
          </div>
        )}
      </div>
      <Composer c={c} files={files} setFiles={setFiles} addFiles={addFiles} disabled={needsEmail || !s.session} />
    </>
  );
}

function Bubble({ m, me, grouped, onRetry }: { m: UiMessage; me: boolean; grouped: boolean; onRetry: () => void }) {
  const who = m.author.user?.name ?? (m.author.type === "system" ? t("automated") : t("support"));
  const hasBody = me ? !!m.body_text : !!(m.body_html || m.body_text);
  return (
    <div class={`row ${me ? "me" : "them"}${grouped ? "" : " gap"}`}>
      {!me && !grouped && (
        <div class="who">
          <span class="av" aria-hidden="true">
            {m.author.user?.avatar_url ? <img src={m.author.user.avatar_url} alt="" referrerpolicy="no-referrer" /> : initials(who)}
          </span>
          {who}
        </div>
      )}
      {hasBody &&
        (me || !m.body_html ? (
          <div class="msg" dir="auto">{m.body_text}</div>
        ) : (
          <div class="msg" dangerouslySetInnerHTML={{ __html: safeHtml(m.body_html) }} />
        ))}
      {m.attachments.length > 0 && (
        <div class="files">
          {m.attachments.map((a) => (
            <FileView key={a.id} a={a} />
          ))}
        </div>
      )}
      {m.local === "failed" ? (
        <div class="meta failed">
          {t("notSent")} <button onClick={onRetry}>{t("retry")}</button>
        </div>
      ) : m.local === "pending" ? (
        <div class="meta">{t("sending")}</div>
      ) : !grouped || me ? (
        <div class="meta">{clock(m.created_at)}</div>
      ) : null}
    </div>
  );
}

/** A workspace's own greeting, or the stock one in the visitor's language. */
function greeting(g: string | null | undefined) {
  const v = g?.trim();
  return !v || STOCK_GREETINGS.has(v.toLowerCase()) ? t("greeting") : v;
}
const STOCK_GREETINGS = new Set(["hi there. how can we help?", "hi there! how can we help?"]);

type Offer = "idle" | "pending" | "done" | "failed" | null;

function AiBubble({ m, name, offer, onHandoff }: { m: UiMessage; name: string; offer: Offer; onHandoff: () => void }) {
  const sources = sourcesOf(m);
  return (
    <div class="row them gap ai">
      <div class="who">
        <span class="av ai-av" aria-hidden="true">
          {Sparkle(11)}
        </span>
        {name}
        <span class="ai-pill" title={t("aiAnswer")}>
          <span class="sr">{t("aiAnswer")}</span>
          <span aria-hidden="true">{t("ai")}</span>
        </span>
      </div>
      {m.body_html ? <div class="msg" dangerouslySetInnerHTML={{ __html: safeHtml(m.body_html) }} /> : <div class="msg">{m.body_text}</div>}
      {sources.length > 0 && (
        <div class="sources">
          <div class="sources-h">{t("sources")}</div>
          {sources.map((src) => (
            <a key={src.url} class="src" href={src.url} target="_blank" rel="noopener noreferrer nofollow">
              <FileIc />
              <span>{src.title}</span>
              <span class="flip">
                <Ext />
              </span>
            </a>
          ))}
        </div>
      )}
      {offer === "done" ? (
        <div class="handoff-note" role="status">
          <Check />
          {t("handoffDone")}
        </div>
      ) : offer ? (
        <>
          <button class="handoff" disabled={offer === "pending"} aria-busy={offer === "pending"} onClick={onHandoff}>
            <Person />
            {t("talkToPerson")}
          </button>
          {offer === "failed" && <div class="meta failed">{t("handoffFailed")}</div>}
        </>
      ) : null}
      <div class="meta">{clock(m.created_at)}</div>
    </div>
  );
}

function FileView({ a }: { a: Attachment }) {
  if (a.content_type.startsWith("image/") && a.url)
    return (
      <a href={a.url} target="_blank" rel="noopener noreferrer">
        <img class="thumb" src={a.url} alt={a.filename} loading="lazy" />
      </a>
    );
  return (
    <a class="chip" href={a.url || undefined} target="_blank" rel="noopener noreferrer">
      <FileIc />
      <span>{a.filename}</span>
      <small>{size(a.size_bytes)}</small>
    </a>
  );
}

// ── Email capture ────────────────────────────────────────────────────────────

function Capture({ c }: { c: Controller }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErr(t("invalidEmail"));
    setBusy(true);
    setErr(null);
    try {
      await c.captureEmail(name.trim(), email.trim());
    } catch {
      setErr(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="capture" onSubmit={submit}>
      <p>{t("captureHint")}</p>
      <input class="field" placeholder={t("name")} aria-label={t("name")} value={name} onInput={(e) => setName(e.currentTarget.value)} autocomplete="name" />
      <input class="field" type="email" placeholder={t("emailPlaceholder")} aria-label={t("email")} dir="ltr" value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="email" required />
      {err && <div class="err">{err}</div>}
      <button class="primary" type="submit" disabled={busy} style={{ height: "36px" }}>
        {busy ? t("saving") : t("continue")}
      </button>
    </form>
  );
}

// ── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  c,
  files,
  setFiles,
  addFiles,
  disabled,
}: {
  c: Controller;
  files: File[];
  setFiles: (f: File[]) => void;
  addFiles: (f: FileList | null) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = () => {
    if (disabled || (!text.trim() && !files.length)) return;
    void c.send(text, files);
    setText("");
    setFiles([]);
    ta.current?.focus();
  };

  return (
    <div class="composer">
      {files.length > 0 && (
        <div class="pending-files">
          {files.map((f, i) => (
            <span class="chip" key={`${f.name}-${i}`}>
              <FileIc />
              <span>{f.name}</span>
              <button aria-label={t("removeFile", { name: f.name })} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                {X(12)}
              </button>
            </span>
          ))}
        </div>
      )}
      <div class="cbar">
        <textarea
          ref={ta}
          class="input"
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? t("placeholderEmail") : t("placeholder")}
          aria-label={t("message")}
          dir="auto"
          onInput={(e) => {
            setText(e.currentTarget.value);
            c.typing();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const f = e.clipboardData?.files;
            if (f && f.length) {
              e.preventDefault();
              addFiles(f);
            }
          }}
        />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <button class="icon-btn" aria-label={t("attach")} disabled={disabled} onClick={() => picker.current?.click()}>
          <Clip />
        </button>
        <button class="send" aria-label={t("send")} disabled={disabled || (!text.trim() && !files.length)} onClick={send}>
          <Up />
        </button>
      </div>
    </div>
  );
}

