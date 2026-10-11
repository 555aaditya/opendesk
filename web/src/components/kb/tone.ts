import type { KbCollection } from "@/lib/api/types";
import { SERIES, type Tone } from "@/lib/tones";

/** A collection's hue, by its place in the ordered list, so neighbours never share a colour. */
export function collectionTone(collections: KbCollection[] | undefined, id: string | null | undefined): Tone {
  const sorted = [...(collections ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const i = sorted.findIndex((c) => c.id === id);
  return i < 0 ? "gray" : SERIES[i % SERIES.length];
}
