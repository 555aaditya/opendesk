// A soft two-note chime for a new reply while the page is hidden, made with
// WebAudio (no asset to download). Browsers only let audio start after a user
// gesture, so the context is created on the visitor's first interaction with
// the widget; until then the chime is skipped.

type Ctx = AudioContext;
let ctx: Ctx | null = null;

/** Call from a user gesture inside the widget. */
export function primeSound() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return;
  }
  const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
  if (!AC) return;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
}

export function chime() {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.12;
  out.connect(ctx.destination);
  [
    [880, 0],
    [1318.5, 0.11],
  ].forEach(([freq, at]) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, now + at);
    g.gain.linearRampToValueAtTime(0.5, now + at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.42);
    o.connect(g).connect(out);
    o.start(now + at);
    o.stop(now + at + 0.45);
  });
}
