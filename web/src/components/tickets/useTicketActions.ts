// Ticket mutations. Property edits (status, priority, assignee, team, tags,
// spam, snooze) are predictable, so they patch every cache at once and roll
// back on failure. Merge and delete wait for the server.

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import type { Member, Tag, TagGroup, TagRef, Team, Ticket, TicketPatch } from "@/lib/api/types";
import { qk } from "@/lib/queries";
import { cachedTicket, patchTicketEverywhere, removeTicketEverywhere } from "@/lib/ticketCache";
import { useSession } from "@/lib/session";
import { toast } from "@/components/ui/toast";
import { isApiError } from "@/lib/api/client";
import { focusField, isUnknownLabel, requiredFieldKeys } from "./fields";

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
  const fp = p.fields;
  if (fp) {
    const cur = { ...(t.fields ?? {}) };
    for (const [k, v] of Object.entries(fp)) {
      if (v === null || v === "" || (Array.isArray(v) && !v.length)) delete cur[k];
      else cur[k] = v;
    }
    next.fields = cur;
  }
  if (p.tags !== undefined || p.add_tags || p.remove_tags) {
    const known = qc.getQueryData<Tag[]>(qk.tags) ?? [];
    const groups = qc.getQueryData<TagGroup[]>(qk.tagGroups) ?? [];
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const toRef = (name: string): TagRef => {
      const k = known.find((x) => same(x.name, name));
      return k ? { id: k.id, name: k.name, color: k.color, group_id: k.group_id } : { id: `tmp-${name}`, name, color: "gray", group_id: null };
    };
    let names = p.tags ?? t.tags.map((x) => x.name);
    if (p.add_tags) names = [...names, ...p.add_tags.filter((n) => !names.some((x) => same(x, n)))];
    if (p.remove_tags) names = names.filter((n) => !p.remove_tags!.some((x) => same(x, n)));
    // Exclusive groups keep the label named last (as the server does).
    const refs = names.map(toRef);
    next.tags = refs.filter((r, i) => {
      const g = r.group_id && groups.find((x) => x.id === r.group_id);
      return !g || !g.exclusive || !refs.slice(i + 1).some((o) => o.group_id === r.group_id);
    });
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
      // Solving with an empty required field: open that field instead of a bare error.
      const missing = requiredFieldKeys(e);
      if (missing.length) {
        focusField(missing[0]);
        toast.error(isApiError(e) && e.detail ? e.detail : "Fill in the required fields before solving");
        return;
      }
      if (isUnknownLabel(e)) {
        toast.error(isApiError(e) && e.detail ? e.detail : "Only admins can create labels. Pick an existing one.");
        return;
      }
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
          const p = patch.tags ? { ...patch, add_tags: [...(patch.add_tags ?? []), ...patch.tags], tags: undefined } : patch;
          patchTicketEverywhere(qc, applyPatch(qc, t, p), me);
        }
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      ctx?.prev.forEach((t) => patchTicketEverywhere(qc, t, me));
      if (isUnknownLabel(e)) return void toast.error(isApiError(e) && e.detail ? e.detail : "Only admins can create labels. Pick an existing one.");
      const missing = requiredFieldKeys(e);
      if (missing.length) return void toast.error(isApiError(e) && e.detail ? e.detail : "Some tickets have required fields to fill in before solving");
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
