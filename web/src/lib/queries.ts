// Query keys and queryOptions factories. Hooks, route loaders and the realtime
// cache patcher all go through these, so a prefetched page hits the same key
// its component reads.

import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, rows, type TicketListQuery } from "./api/endpoints";
import type { Page, ReportsRange } from "./api/types";

export const qk = {
  authConfig: ["auth-config"] as const,
  workspace: ["workspace"] as const,
  sessions: ["me", "sessions"] as const,
  counts: ["tickets", "counts"] as const,
  ticketLists: ["tickets", "list"] as const,
  tickets: (q: TicketListQuery) => ["tickets", "list", q] as const,
  ticket: (id: string) => ["tickets", "detail", id] as const,
  messages: (id: string) => ["tickets", "messages", id] as const,
  activities: (id: string) => ["tickets", "activities", id] as const,
  contactLists: ["contacts", "list"] as const,
  contacts: (q: { q?: string; company_id?: string }) => ["contacts", "list", q] as const,
  contact: (id: string) => ["contacts", "detail", id] as const,
  contactTickets: (id: string) => ["contacts", "tickets", id] as const,
  companyLists: ["companies", "list"] as const,
  companies: (q: { q?: string }) => ["companies", "list", q] as const,
  company: (id: string) => ["companies", "detail", id] as const,
  tags: ["tags"] as const,
  tagGroups: ["tag-groups"] as const,
  /** Every entity's custom fields, archived included; filter by `entity` when reading. */
  customFields: ["custom-fields"] as const,
  savedReplies: ["saved-replies"] as const,
  views: ["views"] as const,
  slaPolicies: ["sla-policies"] as const,
  automations: ["automations"] as const,
  mailboxes: ["mailboxes"] as const,
  members: ["members"] as const,
  invitations: ["invitations"] as const,
  teams: ["teams"] as const,
  apiKeys: ["api-keys"] as const,
  webhooks: ["webhooks"] as const,
  webhookDeliveries: (id: string) => ["webhooks", "deliveries", id] as const,
  auditLogs: ["audit-logs"] as const,
  notifications: ["notifications"] as const,
  kbCollections: ["kb", "collections"] as const,
  kbArticleLists: ["kb", "articles"] as const,
  kbArticles: (q: { collection_id?: string; status?: string; q?: string }) => ["kb", "articles", q] as const,
  kbArticle: (id: string) => ["kb", "article", id] as const,
  search: (q: string) => ["search", q] as const,
  reports: (r: ReportsRange) => ["reports", r] as const,
  widgetSettings: ["widget-settings"] as const,
  publicHelp: (slug: string) => ["public", "help", slug] as const,
  publicCollection: (slug: string, c: string) => ["public", "help", slug, "c", c] as const,
  publicArticle: (slug: string, a: string) => ["public", "help", slug, "a", a] as const,
  publicSearch: (slug: string, q: string) => ["public", "help", slug, "search", q] as const,
  csat: (token: string) => ["public", "csat", token] as const,
  invitationLookup: (token: string) => ["invitation-lookup", token] as const,
  billing: ["billing"] as const,
  billingUsage: (r: { from: string; to: string }) => ["billing", "usage", r] as const,
  aiConfig: ["ai", "config"] as const,
  aiSearch: (q: string) => ["ai", "search", q] as const,
  assignment: ["assignment"] as const,
  triage: ["triage"] as const,
  businessHours: ["business-hours"] as const,
  onboarding: ["onboarding"] as const,
};

const list = <R>(key: readonly unknown[], fn: () => Promise<R[] | Page<R>>) =>
  queryOptions({ queryKey: key, queryFn: async () => rows(await fn()) });

export const q = {
  authConfig: () => queryOptions({ queryKey: qk.authConfig, queryFn: api.auth.config, staleTime: 5 * 60_000 }),
  workspace: () => queryOptions({ queryKey: qk.workspace, queryFn: api.workspaces.current }),
  sessions: () => list(qk.sessions, api.me.sessions),
  counts: () => queryOptions({ queryKey: qk.counts, queryFn: api.tickets.counts, staleTime: 30_000 }),
  tickets: (query: TicketListQuery) =>
    infiniteQueryOptions({
      queryKey: qk.tickets(query),
      queryFn: ({ pageParam }) => api.tickets.list({ ...query, limit: 50, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor,
      staleTime: 15_000,
    }),
  ticket: (id: string) => queryOptions({ queryKey: qk.ticket(id), queryFn: () => api.tickets.get(id) }),
  messages: (id: string) => list(qk.messages(id), () => api.tickets.messages(id)),
  activities: (id: string) => list(qk.activities(id), () => api.tickets.activities(id)),
  contacts: (query: { q?: string; company_id?: string }) =>
    infiniteQueryOptions({
      queryKey: qk.contacts(query),
      queryFn: ({ pageParam }) => api.contacts.search({ ...query, limit: 50, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor,
    }),
  contact: (id: string) => queryOptions({ queryKey: qk.contact(id), queryFn: () => api.contacts.get(id) }),
  contactTickets: (id: string) => list(qk.contactTickets(id), () => api.contacts.tickets(id, { limit: 20 })),
  companies: (query: { q?: string }) =>
    infiniteQueryOptions({
      queryKey: qk.companies(query),
      queryFn: ({ pageParam }) => api.companies.search({ ...query, limit: 50, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor,
    }),
  company: (id: string) => queryOptions({ queryKey: qk.company(id), queryFn: () => api.companies.get(id) }),
  tags: () => list(qk.tags, () => api.tags.list()),
  tagGroups: () => list(qk.tagGroups, () => api.tagGroups.list()),
  customFields: () => list(qk.customFields, () => api.customFields.list()),
  savedReplies: () => list(qk.savedReplies, () => api.savedReplies.list({ limit: 100 })),
  views: () => list(qk.views, () => api.views.list({ limit: 100 })),
  slaPolicies: () => list(qk.slaPolicies, () => api.slaPolicies.list({ limit: 100 })),
  automations: () => list(qk.automations, () => api.automations.list({ limit: 100 })),
  mailboxes: () => list(qk.mailboxes, () => api.mailboxes.list({ limit: 100 })),
  members: () => list(qk.members, () => api.members.list()),
  invitations: () => list(qk.invitations, () => api.invitations.list()),
  teams: () => list(qk.teams, () => api.teams.list({ limit: 100 })),
  apiKeys: () => list(qk.apiKeys, () => api.apiKeys.list({ limit: 100 })),
  webhooks: () => list(qk.webhooks, () => api.webhooks.list({ limit: 100 })),
  webhookDeliveries: (id: string) => list(qk.webhookDeliveries(id), () => api.webhooks.deliveries(id, { limit: 50 })),
  auditLogs: () =>
    infiniteQueryOptions({
      queryKey: qk.auditLogs,
      queryFn: ({ pageParam }) => api.auditLogs({ limit: 50, cursor: pageParam }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.next_cursor,
    }),
  notifications: () => list(qk.notifications, () => api.notifications.list({ limit: 50 })),
  kbCollections: () => list(qk.kbCollections, () => api.kb.collections.list({ limit: 100 })),
  kbArticles: (query: { collection_id?: string; status?: "draft" | "published"; q?: string }) =>
    list(qk.kbArticles(query), () => api.kb.articles.search({ ...query, limit: 100 })),
  kbArticle: (id: string) => queryOptions({ queryKey: qk.kbArticle(id), queryFn: () => api.kb.articles.get(id) }),
  search: (term: string) =>
    queryOptions({ queryKey: qk.search(term), queryFn: () => api.search(term), enabled: term.trim().length > 1, staleTime: 10_000 }),
  reports: (r: ReportsRange) => queryOptions({ queryKey: qk.reports(r), queryFn: () => api.reports.overview(r) }),
  billing: () => queryOptions({ queryKey: qk.billing, queryFn: api.billing.get, staleTime: 60_000 }),
  billingUsage: (r: { from: string; to: string }) => queryOptions({ queryKey: qk.billingUsage(r), queryFn: () => api.billing.usage(r) }),
  /** AI availability. A failure (older server, ai_disabled) reads as "off". */
  aiConfig: () =>
    queryOptions({
      queryKey: qk.aiConfig,
      queryFn: () => api.ai.config().catch(() => null),
      staleTime: 5 * 60_000,
    }),
  aiSearch: (query: string) => queryOptions({ queryKey: qk.aiSearch(query), queryFn: () => api.ai.search(query), enabled: query.trim().length > 1 }),
  widgetSettings: () => queryOptions({ queryKey: qk.widgetSettings, queryFn: api.widgetSettings.get }),
  assignment: () => queryOptions({ queryKey: qk.assignment, queryFn: api.assignment.get }),
  triage: () => queryOptions({ queryKey: qk.triage, queryFn: api.triage.get }),
  businessHours: () => queryOptions({ queryKey: qk.businessHours, queryFn: api.businessHours.get }),
  onboarding: () => queryOptions({ queryKey: qk.onboarding, queryFn: api.onboarding.get, staleTime: 30_000 }),
  publicHelp: (slug: string) => queryOptions({ queryKey: qk.publicHelp(slug), queryFn: () => api.public.help(slug) }),
  publicCollection: (slug: string, c: string) =>
    queryOptions({ queryKey: qk.publicCollection(slug, c), queryFn: () => api.public.collection(slug, c) }),
  publicArticle: (slug: string, a: string) =>
    queryOptions({ queryKey: qk.publicArticle(slug, a), queryFn: () => api.public.article(slug, a) }),
  publicSearch: (slug: string, term: string) =>
    queryOptions({ queryKey: qk.publicSearch(slug, term), queryFn: () => api.public.search(slug, term), enabled: term.trim().length > 1 }),
  csat: (token: string) => queryOptions({ queryKey: qk.csat(token), queryFn: () => api.public.csat(token), retry: false }),
  invitationLookup: (token: string) =>
    queryOptions({ queryKey: qk.invitationLookup(token), queryFn: () => api.invitations.lookup(token), retry: false }),
};

/** Upsert or remove one row in a plain list cache keyed by id. */
export function upsertInList<R extends { id: string }>(qc: QueryClient, key: readonly unknown[], row: R, opts: { prepend?: boolean } = {}) {
  qc.setQueryData<R[]>(key, (old) => {
    if (!old) return old;
    const i = old.findIndex((x) => x.id === row.id);
    if (i >= 0) {
      const next = old.slice();
      next[i] = row;
      return next;
    }
    return opts.prepend ? [row, ...old] : [...old, row];
  });
}

export function removeFromList<R extends { id: string }>(qc: QueryClient, key: readonly unknown[], id: string) {
  qc.setQueryData<R[]>(key, (old) => old?.filter((x) => x.id !== id));
}
