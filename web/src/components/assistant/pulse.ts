// A keystroke signal from the composer to every JevMark rendered with `listen`,
// so the blob boops while someone types to it.

const subscribers = new Set<() => void>();

export function pulseJev() {
  subscribers.forEach((fn) => fn());
}

export function onJevPulse(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
