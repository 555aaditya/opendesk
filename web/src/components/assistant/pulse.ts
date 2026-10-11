// A keystroke signal from the composer to every OllieMark rendered with `listen`,
// so the blob boops while someone types to it.

const subscribers = new Set<() => void>();

export function pulseOllie() {
  subscribers.forEach((fn) => fn());
}

export function onOlliePulse(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
