// Optimistic edits for the plain list caches settings pages read.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";

type Row = { id: string };

/**
 * A mutation that patches `key` (an array cache) before the request, restores
 * it on error and refetches when it settles.
 */
export function useListMutation<R extends Row, V>(
  key: readonly unknown[],
  mutationFn: (v: V) => Promise<unknown>,
  patch: (rows: R[], v: V) => R[],
  opts: { errorText?: string; onSuccess?: (res: unknown, v: V) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<R[]>(key);
      if (prev) qc.setQueryData<R[]>(key, patch(prev, v));
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(e, opts.errorText);
    },
    onSuccess: (res, v) => opts.onSuccess?.(res, v),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** Swap positions of two neighbours and renumber 0..n. */
export function moveItem<T extends { id: string; position: number }>(rows: T[], id: string, dir: -1 | 1): T[] {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return rows;
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return sorted.map((r, idx) => ({ ...r, position: idx }));
}
