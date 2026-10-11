// Ticket mutations. Property edits (status, priority, assignee, team, tags,
// spam, snooze) are predictable, so they patch every cache at once and roll
// back on failure. Merge and delete wait for the server.

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import type { Member, Tag, Team, Ticket, TicketPatch } from "@/lib/api/types";
import { qk } from "@/lib/queries";
import { cachedTicket, patchTicketEverywhere, removeTicketEverywhere } from "@/lib/ticketCache";
import { useSession } from "@/lib/session";
import { toast } from "@/components/ui/toast";

/** Apply a PATCH body to a ticket locally, resolving ids to the refs the server would return. */
export function applyPatch(qc: QueryClient, t: Ticket, p: TicketPatch): Ticket {
  const next: Ticket = { ...t, updated_at: new Date().toISOString() };
  if (p.subject !== undefined) next.subject = p.subject;
  if (p.status !== undefined) {
    next.status = p.status;
    if (p.status === "solved" && !t.solved_at) next.solved_at = new Date().toISOString();
  }
  if (p.priority !== undefined) next.priority = p.priority;
  if (p.spam !== undefined) next.spam = p.spam;
  if (p.snoozed_until !== undefined) next.snoozed_until = p.snoozed_until;
  if (p.team_id !== undefined) next.team_id = p.team_id;
  if (p.assignee_id !== undefined) {
    if (p.assignee_id === null) next.assignee = null;
    else {
      const m = qc.getQueryData<Member[]>(qk.members)?.find((x) => x.user.id === p.assignee_id);
      next.assignee = m ? m.user : t.assignee;
    }
  }
  if (p.tags !== undefined) {
    const known = qc.getQueryData<Tag[]>(qk.tags) ?? [];
    next.tags = p.tags.map((name) => known.find((k) => k.name.toLowerCase() === name.toLowerCase()) ?? { id: `tmp-${name}`, name });
  }
  return next;
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id ?? "");
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TicketPatch; quiet?: boolean }) => api.tickets.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.ticket(id) });
      const prev = cachedTicket(qc, id);
      if (prev) patchTicketEverywhere(qc, applyPatch(qc, prev, patch), me);
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) patchTicketEverywhere(qc, ctx.prev, me);
      toast.error(e, "Couldn't update the ticket");
    },
    onSuccess: (t) => {
      patchTicketEverywhere(qc, t, me);
      if (t.tags.some((x) => !qc.getQueryData<Tag[]>(qk.tags)?.some((k) => k.id === x.id))) void qc.invalidateQueries({ queryKey: qk.tags });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.counts }),
  });
}

export function useBulkUpdate() {
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id ?? "");
  return useMutation({
    mutationFn: (b: { ids: string[]; patch?: TicketPatch; delete?: true }) => api.tickets.bulk(b),
    onMutate: ({ ids, patch, delete: del }) => {
      const prev = ids.map((id) => cachedTicket(qc, id)).filter((t): t is Ticket => !!t);
      for (const t of prev) {
        if (del) removeTicketEverywhere(qc, t.id);
        else if (patch) {
          // Bulk tags add to the existing set (see contracts); single edits replace.
          const p = patch.tags ? { ...patch, tags: Array.from(new Set([...t.tags.map((x) => x.name), ...patch.tags])) } : patch;
          patchTicketEverywhere(qc, applyPatch(qc, t, p), me);
        }
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      ctx?.prev.forEach((t) => patchTicketEverywhere(qc, t, me));
      toast.error(e, "Couldn't update those tickets");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.counts });
      void qc.invalidateQueries({ queryKey: qk.ticketLists });
    },
  });
}

export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.tickets.delete(id),
    onSuccess: (_r, id) => {
      removeTicketEverywhere(qc, id);
      qc.removeQueries({ queryKey: qk.ticket(id) });
      void qc.invalidateQueries({ queryKey: qk.counts });
    },
  });
}

export function useMergeTicket() {
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id ?? "");
  return useMutation({
    mutationFn: ({ id, into }: { id: string; into: string }) => api.tickets.merge(id, into),
    onSuccess: (target, { id }) => {
      removeTicketEverywhere(qc, id);
      if (target?.id) {
        patchTicketEverywhere(qc, target, me);
        void qc.invalidateQueries({ queryKey: qk.messages(target.id) });
        void qc.invalidateQueries({ queryKey: qk.activities(target.id) });
      }
      void qc.invalidateQueries({ queryKey: qk.counts });
    },
  });
}

export function teamName(teams: Team[] | undefined, id: string | null) {
  return id ? teams?.find((t) => t.id === id)?.name ?? "Team" : null;
}
