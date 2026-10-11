// Every rule lives inside the shadow root, so nothing leaks into the host page
// and the host page's CSS can't reach in. Monochrome chrome with squarish
// corners (the mark's modules); --brand is the only colour a workspace can
// change, and AI answers carry the product's one AI hue (violet).

export const css = `
:host { all: initial; }
:host {
  --bg: #ffffff; --bg-2: #f4f4f4; --bg-3: #fafafa; --line: #e4e4e4; --line-2: #d4d4d4;
  --fg: #0a0a0a; --fg-2: #525252; --fg-3: #737373; --fg-4: #a3a3a3;
  --accent: var(--brand, #0a0a0a); --accent-fg: var(--brand-fg, #ffffff);
  --launcher: var(--brand, #0a0a0a); --launcher-fg: var(--brand-fg, #ffffff);
  --ai: #6f4bac; --ai-soft: #f6efff; --ai-line: #e3d5ff;
  --shadow: 0 0 0 1px rgb(10 10 10 / .06), 0 12px 28px -8px rgb(10 10 10 / .2), 0 32px 64px -20px rgb(10 10 10 / .26);
  --ring: color-mix(in srgb, var(--fg) 8%, transparent);
  --danger: #dc2626;
  --ease: cubic-bezier(.16, 1, .3, 1);
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "PingFang SC", "Microsoft YaHei", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "Segoe UI Arabic", "Geeza Pro", "Noto Sans Arabic", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #171717; --bg-2: #262626; --bg-3: #1c1c1c; --line: #2e2e2e; --line-2: #3a3a3a;
    --fg: #fafafa; --fg-2: #c4c4c4; --fg-3: #8a8a8a; --fg-4: #5c5c5c;
    --accent: var(--brand, #fafafa); --accent-fg: var(--brand-fg, #0a0a0a);
    --ai: #c7adff; --ai-soft: #261f33; --ai-line: #3a3050;
    --shadow: 0 0 0 1px rgb(255 255 255 / .08), 0 12px 28px -8px rgb(0 0 0 / .6), 0 32px 64px -20px rgb(0 0 0 / .7);
    --ring: color-mix(in srgb, var(--fg) 12%, transparent);
    --danger: #f87171;
  }
  .launcher { box-shadow: 0 0 0 1px rgb(255 255 255 / .14), 0 8px 20px -6px rgb(0 0 0 / .6); }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; background: none; border: 0; }
.root { font-family: var(--font); font-size: 14px; line-height: 20px; color: var(--fg); -webkit-font-smoothing: antialiased; }
:focus { outline: none; }
:focus-visible { outline: 2px solid color-mix(in srgb, var(--fg) 30%, transparent); outline-offset: 2px; }
textarea:focus-visible, input:focus-visible { outline: none; }

/* Launcher: a rounded square, like the mark's modules. */
.launcher {
  position: fixed; right: 20px; bottom: 20px; width: 54px; height: 54px; border-radius: 16px;
  background: var(--launcher); color: var(--launcher-fg); display: grid; place-items: center;
  box-shadow: 0 0 0 1px rgb(255 255 255 / .08) inset, 0 8px 20px -6px rgb(0 0 0 / .32), 0 2px 4px rgb(0 0 0 / .1);
  transition: transform .2s var(--ease), box-shadow .2s;
  pointer-events: auto; animation: launcher-in .36s var(--ease) both;
}
.launcher:hover { transform: translateY(-1px) scale(1.03); }
.launcher:active { transform: scale(.96); transition-duration: .08s; }
.launcher .ic { position: absolute; display: grid; place-items: center; transition: transform .24s var(--ease), opacity .16s; }
.launcher .ic-x { opacity: 0; transform: rotate(-45deg) scale(.6); }
.launcher[aria-expanded="true"] .ic-mark { opacity: 0; transform: rotate(45deg) scale(.6); }
.launcher[aria-expanded="true"] .ic-x { opacity: 1; transform: none; }
@keyframes launcher-in { from { opacity: 0; transform: translateY(6px) scale(.92); } to { opacity: 1; transform: none; } }
.badge {
  position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 6px;
  background: var(--danger); color: #fff; font-size: 11px; font-weight: 600; line-height: 20px; text-align: center;
  font-variant-numeric: tabular-nums; box-shadow: 0 0 0 2px var(--bg); animation: snap .22s var(--ease);
}
@keyframes snap { from { transform: scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }

/* Panel: springs open from the launcher corner, eases out on close. */
.panel {
  position: fixed; right: 20px; bottom: 86px; width: 380px; height: min(620px, calc(100vh - 110px));
  display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: var(--bg); border-radius: 12px; box-shadow: var(--shadow);
  transform-origin: bottom right; animation: panel-in .26s var(--ease) both;
}
@supports (animation-timing-function: linear(0, 1)) {
  .panel {
    animation-duration: .42s;
    animation-timing-function: linear(0, .06 2%, .23 5%, .47 9%, .7 14%, .86 20%, .95 27%, 1 35%, 1.012 45%, 1.006 62%, 1);
  }
}
.panel.leaving { animation: panel-out .16s cubic-bezier(.4, 0, 1, 1) both; pointer-events: none; }
@keyframes panel-in { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes panel-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(6px) scale(.98); } }
@media (max-width: 479px) {
  .panel { inset: 0; width: auto; height: 100%; border-radius: 0; bottom: 0; right: 0; transform-origin: bottom center; }
  .launcher.hide-mobile { display: none; }
}

.head { padding: 14px 14px 12px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); }
.head.home { padding: 20px 20px 22px; align-items: flex-start; background: var(--bg-3); }
.head-main { flex: 1; min-width: 0; }
.ws { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; letter-spacing: -.01em; }
.ws-glyph { width: 22px; height: 22px; border-radius: 5px; background: var(--accent); color: var(--accent-fg); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
.greet { margin-top: 14px; font-size: 21px; line-height: 27px; font-weight: 600; letter-spacing: -.025em; }
.sub { margin-top: 4px; color: var(--fg-3); font-size: 13px; }
.title { font-size: 14px; font-weight: 600; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.title-sub { font-size: 12px; color: var(--fg-3); margin-top: 1px; }
.icon-btn { width: 30px; height: 30px; flex: none; border-radius: 6px; display: grid; place-items: center; color: var(--fg-3); transition: background .12s, color .12s, transform .12s; }
.icon-btn:hover { background: var(--bg-2); color: var(--fg); }
.icon-btn:active { transform: scale(.94); }
.icon-btn:disabled { opacity: .4; cursor: default; background: none; }

.body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.home-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; animation: rise .3s var(--ease) both; }
.card { border: 1px solid var(--line); border-radius: 8px; background: var(--bg); overflow: hidden; }
.card-h { padding: 12px 14px 6px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-4); }
.conv { width: 100%; display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; text-align: start; border-top: 1px solid var(--line); transition: background .12s; }
.card-h + .conv { border-top: 0; }
.conv:hover { background: var(--bg-3); }
.conv-main { flex: 1; min-width: 0; }
.conv-top { display: flex; justify-content: space-between; gap: 8px; }
.conv-subject { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-prev { font-size: 12.5px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.time { font-family: var(--mono); font-size: 10.5px; color: var(--fg-4); flex: none; }
.dot { width: 7px; height: 7px; border-radius: 99px; margin-top: 6px; flex: none; background: var(--line-2); }
.dot.open { background: var(--accent); }
.primary {
  display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px; border-radius: 7px; width: 100%;
  background: var(--accent); color: var(--accent-fg); font-size: 13.5px; font-weight: 500; transition: opacity .12s, transform .12s;
}
.primary:hover { opacity: .9; }
.primary:active { transform: scale(.985); }
.primary:disabled { opacity: .5; cursor: default; }
.link-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; font-size: 13px; font-weight: 500; color: var(--fg); text-decoration: none; transition: background .12s; }
.link-row:hover { background: var(--bg-3); }
.link-row svg { color: var(--fg-3); transition: transform .16s var(--ease); }
.link-row:hover svg { transform: translate(1px, -1px); }

/* Thread */
.thread { padding: 16px 14px 8px; display: flex; flex-direction: column; gap: 2px; }
.thread-tail { padding-top: 0; }
.day { align-self: center; font-family: var(--mono); font-size: 10.5px; color: var(--fg-4); margin: 10px 0 6px; }
.row { display: flex; flex-direction: column; max-width: 82%; }
.row.me { align-self: flex-end; align-items: flex-end; }
.row.them { align-self: flex-start; align-items: flex-start; }
.row + .row.gap, .thread-tail .row.gap { margin-top: 12px; }
.who { font-size: 11.5px; color: var(--fg-3); margin: 0 2px 4px; display: flex; align-items: center; gap: 6px; }
.av { width: 18px; height: 18px; border-radius: 4px; background: var(--bg-2); color: var(--fg-2); font-size: 8.5px; font-weight: 600; display: grid; place-items: center; overflow: hidden; }
.av img { width: 100%; height: 100%; object-fit: cover; }
.msg { padding: 8px 12px; border-radius: 12px; font-size: 13.5px; line-height: 19px; overflow-wrap: anywhere; animation: rise .24s var(--ease) both; }
@keyframes rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
.me .msg { background: var(--accent); color: var(--accent-fg); border-end-end-radius: 4px; white-space: pre-wrap; transform-origin: bottom right; }
.them .msg { background: var(--bg-2); color: var(--fg); border-end-start-radius: 4px; transform-origin: bottom left; }
.me .msg + .msg, .them .msg + .msg { margin-top: 2px; }
.row.me:not(.gap) .msg { border-start-end-radius: 4px; }
.row.them:not(.gap) .msg { border-start-start-radius: 4px; }
.msg p + p, .msg ul, .msg ol, .msg pre, .msg blockquote { margin-top: 6px; }
.msg ul, .msg ol { padding-inline-start: 18px; }
.msg a { color: inherit; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
.msg a:hover { text-decoration-color: currentColor; }
.msg code { font-family: var(--mono); font-size: 12px; }
.msg pre { font-family: var(--mono); font-size: 12px; white-space: pre-wrap; }
.msg blockquote { border-inline-start: 2px solid var(--line-2); padding-inline-start: 8px; color: var(--fg-2); }
.meta { font-family: var(--mono); font-size: 10px; color: var(--fg-4); margin: 3px 4px 0; display: flex; gap: 6px; align-items: center; }
.meta.failed { color: var(--danger); font-family: var(--font); font-size: 11.5px; }
.meta button { text-decoration: underline; color: inherit; font-size: inherit; }
.files { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.me .files { align-items: flex-end; }
.thumb { display: block; max-width: 220px; max-height: 160px; border-radius: 8px; border: 1px solid var(--line); object-fit: cover; }
.chip { display: inline-flex; align-items: center; gap: 6px; max-width: 240px; height: 30px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg); font-size: 12px; color: var(--fg); text-decoration: none; transition: border-color .12s; }
a.chip:hover { border-color: var(--line-2); }
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip small { color: var(--fg-4); font-family: var(--mono); font-size: 10.5px; flex: none; }

/* Typing (a person) and thinking (the answer bot): one quiet dot wave. */
.typing { align-self: flex-start; display: flex; align-items: center; gap: 8px; padding: 2px 14px 12px; color: var(--fg-3); font-size: 12px; animation: rise .2s var(--ease) both; }
.typing .dots { padding: 11px 12px; border-radius: 12px; border-end-start-radius: 4px; background: var(--bg-2); }
.dots { display: inline-flex; align-items: center; gap: 3px; }
.dots span { width: 5px; height: 5px; border-radius: 99px; background: currentColor; opacity: .35; animation: wave 1.2s infinite ease-in-out; }
.dots span:nth-child(2) { animation-delay: .16s; } .dots span:nth-child(3) { animation-delay: .32s; }
@keyframes wave { 0%, 70%, 100% { opacity: .35; transform: none; } 35% { opacity: 1; transform: translateY(-1.5px); } }
.msg.think { display: inline-flex; align-items: center; gap: 9px; color: var(--ai); padding-block: 9px; }
.shimmer {
  font-size: 12.5px; color: var(--fg-3);
  background: linear-gradient(90deg, var(--fg-3) 0%, var(--fg-3) 35%, var(--fg) 50%, var(--fg-3) 65%, var(--fg-3) 100%) 0 0 / 250% 100%;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  animation: shimmer 1.8s linear infinite;
}
[dir="rtl"] .shimmer { animation-direction: reverse; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }

.empty { padding: 32px 24px; text-align: center; color: var(--fg-3); font-size: 13px; animation: rise .3s var(--ease) both; }
.empty b { display: block; color: var(--fg); font-weight: 600; font-size: 14px; margin-bottom: 4px; }

/* Composer: one inset field with its actions inside. */
.composer { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 6px; background: var(--bg); }
.pending-files { display: flex; flex-wrap: wrap; gap: 6px; }
.pending-files .chip { height: 26px; animation: rise .18s var(--ease) both; }
.pending-files .chip button { color: var(--fg-3); display: grid; place-items: center; border-radius: 3px; }
.pending-files .chip button:hover { color: var(--fg); }
.cbar {
  display: flex; align-items: flex-end; gap: 4px; padding: 5px 5px 5px 12px; padding-inline: 12px 5px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--bg);
  transition: border-color .15s, box-shadow .15s;
}
.cbar:hover { border-color: var(--line-2); }
.cbar:focus-within { border-color: var(--fg-4); box-shadow: 0 0 0 3px var(--ring); }
.cbar.off { background: var(--bg-3); }
.cbar .icon-btn { width: 30px; height: 30px; }
textarea.input {
  flex: 1; resize: none; border: 0; background: transparent; font-size: 14px; line-height: 20px; padding: 5px 0;
  max-height: 120px; min-height: 30px; color: var(--fg);
}
textarea.input:disabled { cursor: not-allowed; }
textarea.input::placeholder, input.field::placeholder { color: var(--fg-4); }
.send { width: 30px; height: 30px; flex: none; border-radius: 6px; display: grid; place-items: center; background: var(--accent); color: var(--accent-fg); transition: opacity .15s, transform .15s var(--ease); }
.send:not(:disabled):hover { opacity: .9; }
.send:not(:disabled):active { transform: scale(.92); }
.send:disabled { opacity: .25; cursor: default; }
.drop { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 88%, transparent); border: 1.5px dashed var(--line-2); border-radius: inherit; font-size: 13px; font-weight: 500; color: var(--fg-2); animation: fade .12s ease-out; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
.capture { margin: 12px 14px 4px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; gap: 8px; background: var(--bg-3); animation: rise .24s var(--ease) both; }
.capture p { font-size: 13px; color: var(--fg-2); }
input.field { height: 36px; border: 1px solid var(--line); border-radius: 6px; padding: 0 10px; background: var(--bg); font-size: 13.5px; color: var(--fg); transition: border-color .15s, box-shadow .15s; }
input.field:hover { border-color: var(--line-2); }
input.field:focus { border-color: var(--fg-4); box-shadow: 0 0 0 3px var(--ring); }
.err { color: var(--danger); font-size: 12px; }
.foot { display: flex; align-items: center; justify-content: center; gap: 5px; height: 30px; font-size: 11px; color: var(--fg-4); border-top: 1px solid var(--line); text-decoration: none; flex: none; transition: color .12s; }
.foot:hover { color: var(--fg-2); }
[dir="rtl"] .flip svg { transform: scaleX(-1); }
[dir="rtl"] .link-row:hover .flip svg { transform: scaleX(-1) translate(1px, -1px); }
.time, .day, .meta { unicode-bidi: plaintext; }

/* AI answers: the product's AI hue, kept to the avatar, pill and a hairline. */
.ai .msg { background: var(--bg-3); border: 1px solid var(--line); }
.ai .msg.think { background: var(--bg-3); }
.ai-av { background: var(--ai-soft); color: var(--ai); box-shadow: inset 0 0 0 1px var(--ai-line); }
.ai-pill {
  display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 4px;
  background: var(--ai-soft); color: var(--ai); font-size: 10px; font-weight: 600; letter-spacing: .03em;
}
.handoff {
  margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 6px;
  border: 1px solid var(--line-2); background: var(--bg); font-size: 12.5px; font-weight: 500; color: var(--fg);
  transition: background .12s, border-color .12s, opacity .12s, transform .12s; animation: rise .24s .1s var(--ease) both;
}
.handoff:hover { background: var(--bg-2); }
.handoff:active { transform: scale(.98); }
.handoff:disabled { opacity: .55; cursor: default; }
.handoff-note { margin-top: 6px; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-2); animation: rise .24s var(--ease) both; }
.handoff-note svg { color: #22a55b; flex: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skel { height: 12px; border-radius: 4px; margin: 10px 14px; background: linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%) 0 0 / 200% 100%; animation: skel 1.4s ease-in-out infinite; }
@keyframes skel { from { background-position: 100% 0; } to { background-position: -100% 0; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .shimmer { -webkit-text-fill-color: currentColor; background: none; }
  .dots span { opacity: .55; }
}
`;
