import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, Pencil, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Textarea, TextInput } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Company } from "@/lib/api/types";
import { shortDate } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { dropCompany, patchCompany, restore, snapshot } from "./cache";

export function CompanyGlyph({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={
        size === "lg"
          ? "flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-sunken text-[12px] font-semibold text-fg-2"
          : "flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-line bg-sunken text-[10px] font-semibold text-fg-2"
      }
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

type Tab = "overview" | "people" | "edit";

export function CompanyDrawer({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("overview");
  const [dirty, setDirty] = useState(false);
  const { data: c, isLoading, error } = useQuery({ ...q.company(companyId ?? ""), enabled: !!companyId });
  useEffect(() => {
    setTab("overview");
    setDirty(false);
  }, [companyId]);
  const requestClose = () => {
    if (!dirty) return onClose();
    confirm.show("Your changes to this company will be lost.", onClose, { title: "Discard changes?", confirmLabel: "Discard", danger: true });
  };

  return (
    <Drawer
      open={!!companyId}
      onOpenChange={(o) => !o && requestClose()}
      title={c?.name ?? "Company"}
      onEscapeKeyDown={(e) => {
        if (dirty) {
          e.preventDefault();
          requestClose();
        }
      }}
      onInteractOutside={(e) => {
        if (dirty) {
          e.preventDefault();
          requestClose();
        }
      }}
      header={
        c ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <CompanyGlyph name={c.name} />
            <span className="truncate text-[13.5px] font-semibold">{c.name}</span>
            {c.domain && <span className="mono truncate text-xs text-fg-3">{c.domain}</span>}
          </div>
        ) : (
          <Skeleton className="h-3 w-40" />
        )
      }
    >
      {error ? (
        <EmptyState lit={3} title="Company not found" description={errorMessage(error)} />
      ) : isLoading || !c ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="sticky top-0 z-10 bg-surface">
            <TabsTrigger value="overview" icon={<Building2 />}>
              Overview
            </TabsTrigger>
            <TabsTrigger value="people" icon={<Users />} count={c.contact_count}>
              People
            </TabsTrigger>
            <TabsTrigger value="edit" icon={<Pencil />}>
              Edit
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="outline-none">
            <div className="flex flex-col gap-6 px-5 py-4">
              <dl className="divide-y divide-line-soft">
                <div className="grid grid-cols-[120px_1fr] gap-3 py-2">
                  <dt className="text-[12.5px] text-fg-3">Domain</dt>
                  <dd className="mono text-xs">{c.domain || <span className="text-fg-4">–</span>}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 py-2">
                  <dt className="text-[12.5px] text-fg-3">People</dt>
                  <dd className="mono text-xs">{c.contact_count}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 py-2">
                  <dt className="text-[12.5px] text-fg-3">Created</dt>
                  <dd className="text-[13px]">{shortDate(c.created_at)}</dd>
                </div>
              </dl>
              <section>
                <h3 className="label-caps mb-2">Notes</h3>
                {c.notes ? (
                  <p className="whitespace-pre-wrap rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-5 text-fg-2">{c.notes}</p>
                ) : (
                  <p className="text-[12.5px] text-fg-4">No notes</p>
                )}
              </section>
            </div>
          </TabsContent>
          <TabsContent value="people" className="outline-none">
            <People companyId={c.id} />
          </TabsContent>
          <TabsContent value="edit" className="outline-none">
            <EditCompany key={c.id + c.updated_at} c={c} onDirty={setDirty} onDeleted={onClose} onSaved={() => setTab("overview")} />
          </TabsContent>
        </Tabs>
      )}
    </Drawer>
  );
}

function People({ companyId }: { companyId: string }) {
  const list = useInfiniteQuery(q.contacts({ company_id: companyId }));
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  if (list.isLoading)
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  if (!rows.length) return <EmptyState compact lit={2} title="No people yet" description="Contacts linked to this company appear here." />;
  return (
    <ul className="py-1">
      {rows.map((p) => (
        <li key={p.id}>
          <Link
            to="/contacts/{-$contactId}"
            params={{ contactId: p.id }}
            search={{ q: undefined, company: undefined }}
            className="flex items-center gap-2.5 border-b border-line-soft px-5 py-2.5 hover:bg-hover/60"
          >
            <Avatar name={p.name || p.email || "?"} src={p.avatar_url} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]" data-ph-mask>
                {p.name || "Unnamed"}
              </span>
              <span className="mono block truncate text-[11.5px] text-fg-3" data-ph-mask>
                {p.email}
              </span>
            </span>
            <span className="mono text-[11px] text-fg-4">{p.ticket_count} tickets</span>
          </Link>
        </li>
      ))}
      {list.hasNextPage && (
        <li className="flex justify-center py-3">
          <Button size="xs" variant="ghost" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            Show more
          </Button>
        </li>
      )}
    </ul>
  );
}

function EditCompany({ c, onDirty, onDeleted, onSaved }: { c: Company; onDirty: (d: boolean) => void; onDeleted: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canEdit = atLeast(useRole(), "agent");
  const [name, setName] = useState(c.name);
  const [domain, setDomain] = useState(c.domain);
  const [notes, setNotes] = useState(c.notes);
  const [error, setError] = useState<string | null>(null);
  const dirty = name !== c.name || domain !== c.domain || notes !== c.notes;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const save = useMutation({
    mutationFn: () => api.companies.update(c.id, { name: name.trim(), domain: domain.trim().toLowerCase(), notes }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.company(c.id) });
      const snap = snapshot(qc, [qk.company(c.id), qk.companyLists]);
      patchCompany(qc, { ...c, name: name.trim(), domain: domain.trim().toLowerCase(), notes });
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      setError(errorMessage(e));
    },
    onSuccess: (u) => {
      patchCompany(qc, u);
      onDirty(false);
      toast.success("Company saved");
      onSaved();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.companies.remove(c.id),
    onSuccess: () => {
      dropCompany(qc, c.id);
      qc.removeQueries({ queryKey: qk.company(c.id) });
      void qc.invalidateQueries({ queryKey: qk.contactLists });
      toast.success("Company deleted");
      onDeleted();
    },
  });

  return (
    <form
      className="flex flex-col gap-4 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setError("A company needs a name.");
        setError(null);
        save.mutate();
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Field label="Name">{(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Domain">{(p) => <TextInput {...p} className="mono" value={domain} onChange={(e) => setDomain(e.target.value)} />}</Field>
        <Field label="Notes">{(p) => <Textarea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </fieldset>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
      {canEdit && (
        <div className="flex items-center justify-between border-t border-line-soft pt-4">
          <Button
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={() =>
              confirm.show("People stay, but they are no longer linked to this company.", () => remove.mutateAsync(), {
                title: `Delete ${c.name}?`,
                confirmLabel: "Delete company",
                danger: true,
              })
            }
          >
            Delete
          </Button>
          <Button variant="primary" type="submit" loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      )}
    </form>
  );
}
