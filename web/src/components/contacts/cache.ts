import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { Company, Contact, Page } from "@/lib/api/types";
import { qk } from "@/lib/queries";

type Pages<T> = InfiniteData<Page<T>, string | null>;

function mapPages<T extends { id: string }>(qc: QueryClient, prefix: readonly unknown[], fn: (rows: T[]) => T[]) {
  const snaps = qc.getQueriesData<Pages<T>>({ queryKey: prefix });
  for (const [key, data] of snaps) {
    if (data) qc.setQueryData<Pages<T>>(key, { ...data, pages: data.pages.map((p) => ({ ...p, data: fn(p.data) })) });
  }
  return snaps;
}

export type Snapshot = [readonly unknown[], unknown][];

export function snapshot(qc: QueryClient, prefixes: (readonly unknown[])[]): Snapshot {
  return prefixes.flatMap((p) => qc.getQueriesData({ queryKey: p }));
}

export function restore(qc: QueryClient, snap: Snapshot) {
  for (const [k, v] of snap) qc.setQueryData(k, v);
}

export function patchContact(qc: QueryClient, c: Contact) {
  qc.setQueryData(qk.contact(c.id), c);
  mapPages<Contact>(qc, qk.contactLists, (rows) => rows.map((r) => (r.id === c.id ? c : r)));
}

export function dropContact(qc: QueryClient, id: string) {
  mapPages<Contact>(qc, qk.contactLists, (rows) => rows.filter((r) => r.id !== id));
}

export function patchCompany(qc: QueryClient, c: Company) {
  qc.setQueryData(qk.company(c.id), c);
  mapPages<Company>(qc, qk.companyLists, (rows) => rows.map((r) => (r.id === c.id ? c : r)));
}

export function dropCompany(qc: QueryClient, id: string) {
  mapPages<Company>(qc, qk.companyLists, (rows) => rows.filter((r) => r.id !== id));
}
