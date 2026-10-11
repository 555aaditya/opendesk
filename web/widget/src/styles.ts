// Every rule lives inside the shadow root, so nothing leaks into the host page
// and the host page's CSS can't reach in. Monochrome; --brand is the only
// colour a workspace can change.

export const css = `
:host { all: initial; }
:host {
  --bg: #ffffff; --bg-2: #f4f4f4; --bg-3: #fafafa; --line: #e4e4e4; --line-2: #d4d4d4;
  --fg: #0a0a0a; --fg-2: #525252; --fg-3: #737373; --fg-4: #a3a3a3;
  --accent: var(--brand, #0a0a0a); --accent-fg: var(--brand-fg, #ffffff);
  --launcher: var(--brand, #0a0a0a); --launcher-fg: var(--brand-fg, #ffffff);
  --shadow: 0 0 0 1px rgb(10 10 10 / .06), 0 12px 28px -8px rgb(10 10 10 / .22), 0 32px 64px -20px rgb(10 10 10 / .28);
  --danger: #dc2626;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "PingFang SC", "Microsoft YaHei", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Segoe UI Arabic", "Geeza Pro", "Noto Sans Arabic", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #171717; --bg-2: #262626; --bg-3: #1c1c1c; --line: #2e2e2e; --line-2: #3a3a3a;
    --fg: #fafafa; --fg-2: #c4c4c4; --fg-3: #8a8a8a; --fg-4: #5c5c5c;
    --accent: var(--brand, #fafafa); --accent-fg: var(--brand-fg, #0a0a0a);
    --shadow: 0 0 0 1px rgb(255 255 255 / .08), 0 12px 28px -8px rgb(0 0 0 / .6), 0 32px 64px -20px rgb(0 0 0 / .7);
    --danger: #f87171;
  }
  .launcher { box-shadow: 0 0 0 1px rgb(255 255 255 / .16), 0 6px 16px -4px rgb(0 0 0 / .5); }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; background: none; border: 0; }
.root { font-family: var(--font); font-size: 14px; line-height: 20px; color: var(--fg); -webkit-font-smoothing: antialiased; }
:focus { outline: none; }
:focus-visible { outline: 2px solid color-mix(in srgb, var(--fg) 30%, transparent); outline-offset: 2px; }
textarea:focus-visible, input:focus-visible { outline: none; }

.launcher {
  position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 999px;
  background: var(--launcher); color: var(--launcher-fg); display: grid; place-items: center;
  box-shadow: 0 0 0 1px rgb(255 255 255 / .08) inset, 0 6px 16px -4px rgb(0 0 0 / .3), 0 2px 4px rgb(0 0 0 / .12);
  transition: transform .18s cubic-bezier(.22,1,.36,1), box-shadow .18s;
  pointer-events: auto;
}
.launcher:hover { transform: scale(1.05); }
.launcher:active { transform: scale(.97); }
.launcher .ic { position: absolute; display: grid; place-items: center; transition: transform .22s cubic-bezier(.22,1,.36,1), opacity .16s; }
.launcher .ic-x { opacity: 0; transform: rotate(-60deg) scale(.6); }
.launcher[aria-expanded="true"] .ic-mark { opacity: 0; transform: rotate(60deg) scale(.6); }
.launcher[aria-expanded="true"] .ic-x { opacity: 1; transform: none; }
.badge {
  position: absolute; top: -2px; right: -2px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px;
  background: var(--danger); color: #fff; font-size: 11px; font-weight: 600; line-height: 20px; text-align: center;
  box-shadow: 0 0 0 2px #fff;
}

.panel {
  position: fixed; right: 20px; bottom: 88px; width: 380px; height: min(600px, calc(100vh - 112px));
  display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: var(--bg); border-radius: 16px; box-shadow: var(--shadow);
  transform-origin: bottom right; animation: pop .22s cubic-bezier(.22,1,.36,1);
}
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
@media (max-width: 479px) {
  .panel { inset: 0; width: auto; height: 100%; border-radius: 0; bottom: 0; right: 0; }
  .launcher.hide-mobile { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .panel, .launcher, .launcher .ic, .dots span, .msg { animation: none !important; transition: none !important; }
}

.head { padding: 16px 16px 14px; display: flex; align-items: flex-start; gap: 10px; border-bottom: 1px solid var(--line); }
.head.home { padding: 22px 20px 20px; background: var(--bg-3); }
.head-main { flex: 1; min-width: 0; }
.ws { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
.ws-glyph { width: 22px; height: 22px; border-radius: 6px; background: var(--fg); color: var(--bg); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
.greet { margin-top: 12px; font-size: 21px; line-height: 27px; font-weight: 600; letter-spacing: -.025em; }
.sub { margin-top: 4px; color: var(--fg-3); font-size: 13px; }
.title { font-size: 14px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title-sub { font-size: 12px; color: var(--fg-3); margin-top: 1px; }
.icon-btn { width: 30px; height: 30px; flex: none; border-radius: 8px; display: grid; place-items: center; color: var(--fg-3); transition: background .1s, color .1s; }
.icon-btn:hover { background: var(--bg-2); color: var(--fg); }

.body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.home-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.card { border: 1px solid var(--line); border-radius: 12px; background: var(--bg); overflow: hidden; }
.card-h { padding: 12px 14px 4px; font-size: 12px; font-weight: 500; color: var(--fg-3); }
.conv { width: 100%; display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; text-align: start; border-top: 1px solid var(--line); transition: background .1s; }
.conv:first-of-type { border-top: 0; }
.conv:hover { background: var(--bg-3); }
.conv-main { flex: 1; min-width: 0; }
.conv-top { display: flex; justify-content: space-between; gap: 8px; }
.conv-subject { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-prev { font-size: 12.5px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.time { font-family: var(--mono); font-size: 10.5px; color: var(--fg-4); flex: none; }
.dot { width: 7px; height: 7px; border-radius: 99px; margin-top: 6px; flex: none; background: var(--line-2); }
.dot.open { background: var(--fg); }
.primary {
  display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px; border-radius: 10px; width: 100%;
  background: var(--accent); color: var(--accent-fg); font-size: 13.5px; font-weight: 500; transition: opacity .12s, transform .12s;
}
.primary:hover { opacity: .9; }
.primary:active { transform: scale(.99); }
.primary:disabled { opacity: .5; cursor: default; }
.link-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; font-size: 13px; font-weight: 500; color: var(--fg); text-decoration: none; }
.link-row:hover { background: var(--bg-3); }
.link-row svg { color: var(--fg-3); }

.thread { padding: 16px 14px 8px; display: flex; flex-direction: column; gap: 2px; }
.day { align-self: center; font-family: var(--mono); font-size: 10.5px; color: var(--fg-4); margin: 10px 0 6px; }
.row { display: flex; flex-direction: column; max-width: 82%; }
.row.me { align-self: flex-end; align-items: flex-end; }
.row.them { align-self: flex-start; align-items: flex-start; }
.row + .row.gap { margin-top: 10px; }
.who { font-size: 11.5px; color: var(--fg-3); margin: 0 4px 3px; display: flex; align-items: center; gap: 6px; }
.av { width: 18px; height: 18px; border-radius: 99px; background: var(--bg-2); color: var(--fg-2); font-size: 8.5px; font-weight: 600; display: grid; place-items: center; overflow: hidden; }
.av img { width: 100%; height: 100%; object-fit: cover; }
.msg { padding: 8px 12px; border-radius: 16px; font-size: 13.5px; line-height: 19px; overflow-wrap: anywhere; animation: rise .2s ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.me .msg { background: var(--accent); color: var(--accent-fg); border-end-end-radius: 6px; white-space: pre-wrap; }
.them .msg { background: var(--bg-2); color: var(--fg); border-end-start-radius: 6px; }
.msg p + p, .msg ul, .msg ol, .msg pre, .msg blockquote { margin-top: 6px; }
.msg ul, .msg ol { padding-inline-start: 18px; }
.msg a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.msg code { font-family: var(--mono); font-size: 12px; }
.msg pre { font-family: var(--mono); font-size: 12px; white-space: pre-wrap; }
.msg blockquote { border-inline-start: 2px solid var(--line-2); padding-inline-start: 8px; color: var(--fg-2); }
.meta { font-family: var(--mono); font-size: 10px; color: var(--fg-4); margin: 3px 6px 0; display: flex; gap: 6px; align-items: center; }
.meta.failed { color: var(--danger); font-family: var(--font); font-size: 11.5px; }
.meta button { text-decoration: underline; color: inherit; font-size: inherit; }
.files { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.me .files { align-items: flex-end; }
.thumb { display: block; max-width: 220px; max-height: 160px; border-radius: 12px; border: 1px solid var(--line); object-fit: cover; }
.chip { display: inline-flex; align-items: center; gap: 6px; max-width: 240px; height: 30px; padding: 0 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--bg); font-size: 12px; color: var(--fg); text-decoration: none; }
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip small { color: var(--fg-4); font-family: var(--mono); font-size: 10.5px; flex: none; }
.typing { align-self: flex-start; display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--fg-3); font-size: 12px; }
.dots { display: inline-flex; gap: 3px; padding: 10px 12px; border-radius: 16px; border-end-start-radius: 6px; background: var(--bg-2); }
.dots span { width: 5px; height: 5px; border-radius: 99px; background: var(--fg-3); animation: blink 1.2s infinite ease-in-out; }
.dots span:nth-child(2) { animation-delay: .15s; } .dots span:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
.empty { padding: 28px 24px; text-align: center; color: var(--fg-3); font-size: 13px; }
.empty b { display: block; color: var(--fg); font-weight: 600; font-size: 14px; margin-bottom: 4px; }

.composer { border-top: 1px solid var(--line); padding-block: 10px; padding-inline: 12px 10px; display: flex; flex-direction: column; gap: 6px; background: var(--bg); }
.pending-files { display: flex; flex-wrap: wrap; gap: 6px; }
.pending-files .chip { height: 26px; }
.pending-files .chip button { color: var(--fg-3); display: grid; place-items: center; }
.cbar { display: flex; align-items: flex-end; gap: 6px; }
textarea.input {
  flex: 1; resize: none; border: 0; background: transparent; font-size: 14px; line-height: 20px; padding: 6px 0;
  max-height: 120px; min-height: 32px; color: var(--fg);
}
textarea.input::placeholder, input.field::placeholder { color: var(--fg-4); }
.send { width: 32px; height: 32px; flex: none; border-radius: 9px; display: grid; place-items: center; background: var(--accent); color: var(--accent-fg); transition: opacity .12s; }
.send:disabled { opacity: .3; cursor: default; }
.drop { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 88%, transparent); border: 2px dashed var(--line-2); border-radius: inherit; font-size: 13px; font-weight: 500; color: var(--fg-2); }
.capture { margin: 12px 14px 4px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; display: flex; flex-direction: column; gap: 8px; background: var(--bg-3); }
.capture p { font-size: 13px; color: var(--fg-2); }
input.field { height: 36px; border: 1px solid var(--line); border-radius: 9px; padding: 0 10px; background: var(--bg); font-size: 13.5px; color: var(--fg); }
input.field:focus { border-color: var(--fg-3); }
.err { color: var(--danger); font-size: 12px; }
.foot { display: flex; align-items: center; justify-content: center; gap: 5px; height: 30px; font-size: 11px; color: var(--fg-4); border-top: 1px solid var(--line); text-decoration: none; flex: none; }
.foot:hover { color: var(--fg-2); }
[dir="rtl"] .flip svg { transform: scaleX(-1); }
.time, .day, .meta { unicode-bidi: plaintext; }

.ai .msg { background: var(--bg-3); border: 1px solid var(--line); }
.ai-av { background: var(--fg); color: var(--bg); }
.ai-pill {
  display: inline-flex; align-items: center; height: 16px; padding: 0 6px; border-radius: 99px;
  border: 1px solid var(--line-2); color: var(--fg-2); font-size: 10px; font-weight: 600; letter-spacing: .02em;
}
.sources { margin-top: 6px; width: 100%; min-width: 220px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--bg); }
.sources-h { padding: 7px 10px 3px; font-size: 11px; font-weight: 500; color: var(--fg-3); }
.src { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--fg); text-decoration: none; border-top: 1px solid var(--line); }
.src:first-of-type { border-top: 0; }
.src:hover { background: var(--bg-3); }
.src > svg, .src .flip { color: var(--fg-3); flex: none; display: grid; }
.src span:not(.flip) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.handoff {
  margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 99px;
  border: 1px solid var(--line-2); background: var(--bg); font-size: 12.5px; font-weight: 500; color: var(--fg); transition: background .1s, opacity .12s;
}
.handoff:hover { background: var(--bg-2); }
.handoff:disabled { opacity: .55; cursor: default; }
.handoff-note { margin-top: 6px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-2); }
.handoff-note svg { color: var(--fg-3); flex: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skel { height: 12px; border-radius: 6px; background: var(--bg-2); margin: 10px 14px; }
`;
