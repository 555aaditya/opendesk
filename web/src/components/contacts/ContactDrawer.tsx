import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, Pencil, Ticket as TicketIcon, Trash2, UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea, TextInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/ui/copy-button";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { StatusIcon, TicketNumber, statusLabel } from "@/components/tickets/bits";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { CompanyRef, Contact } from "@/lib/api/types";
import { fullDate, relShort, shortDate } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { CompanyPicker } from "./CompanyPicker";
import { dropContact, patchContact, restore, snapshot } from "./cache";

type Tab = "overview" | "tickets" | "edit";

export function ContactDrawer({ contactId, onClose }: { contactId: string | null; onClose: () => void }) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("overview");
  const [dirty, setDirty] = useState(false);
  const { data: c, isLoading, error } = useQuery({ ...q.contact(contactId ?? ""), enabled: !!contactId });

  useEffect(() => {
    setTab("overview");
    setDirty(false);
  }, [contactId]);

  const requestClose = () => {
    if (!dirty) return onClose();
    confirm.show("Your changes to this contact will be lost.", onClose, { title: "Discard changes?", confirmLabel: "Discard", danger: true });
  };

  return (
    <Drawer
      open={!!contactId}
      onOpenChange={(o) => !o && requestClose()}
      title={c?.name || "Contact"}
      width={540}
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
            <Avatar name={c.name || c.email || "?"} src={c.avatar_url} size="md" />
            <span className="truncate text-[13.5px] font-semibold" data-ph-mask>
              {c.name || c.email || "Unnamed contact"}
            </span>
            {c.blocked && <Badge tone="danger">Blocked</Badge>}
          </div>
        ) : (
          <Skeleton className="h-3 w-40" />
        )
      }
    >
      {error ? (
        <EmptyState lit={3} title="Contact not found" description={errorMessage(error)} />
      ) : isLoading || !c ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-full flex-col">
          <TabsList className="sticky top-0 z-10 bg-surface">
            <TabsTrigger value="overview" icon={<UserRound />}>
              Overview
            </TabsTrigger>
            <TabsTrigger value="tickets" icon={<TicketIcon />} count={c.ticket_count}>
              Tickets
            </TabsTrigger>
            <TabsTrigger value="edit" icon={<Pencil />}>
              Edit
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="outline-none">
            <Overview c={c} onEdit={() => setTab("edit")} />
          </TabsContent>
          <TabsContent value="tickets" className="outline-none">
            <Tickets contactId={c.id} />
          </TabsContent>
          <TabsContent value="edit" className="outline-none">
            <EditContact key={c.id + c.updated_at} c={c} onDirty={setDirty} onDeleted={onClose} onSaved={() => setTab("overview")} />
          </TabsContent>
        </Tabs>
      )}
    </Drawer>
  );
}

function Detail({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-3 py-2">
      <dt className="text-[12.5px] text-fg-3">{label}</dt>
      <dd className={mono ? "mono min-w-0 truncate text-xs text-fg" : "min-w-0 text-[13px] text-fg"}>{children}</dd>
    </div>
  );
}

const none = <span className="text-fg-4">–</span>;

function Overview({ c, onEdit }: { c: Contact; onEdit: () => void }) {
  const custom = Object.entries(c.custom ?? {});
  return (
    <div className="flex flex-col gap-6 px-5 py-4">
      <dl className="divide-y divide-line-soft">
        <Detail label="Email" mono>
          {c.email ? (
            <span className="flex items-center gap-1" data-ph-mask>
              <span className="truncate">{c.email}</span>
              <CopyButton value={c.email} label="Copy email" className="size-5" />
            </span>
          ) : (
            none
          )}
        </Detail>
        <Detail label="Phone" mono>
          <span data-ph-mask>{c.phone || none}</span>
        </Detail>
        <Detail label="Company">
          {c.company ? (
            <Link
              to="/companies/{-$companyId}"
              params={{ companyId: c.company.id }}
              search={{ q: undefined }}
              className="underline decoration-line-strong underline-offset-2 hover:decoration-fg"
            >
              {c.company.name}
            </Link>
          ) : (
            none
          )}
        </Detail>
        <Detail label="External id" mono>
          {c.external_id || none}
        </Detail>
        <Detail label="Created">
          <span title={fullDate(c.created_at)}>{shortDate(c.created_at)}</span>
        </Detail>
        <Detail label="Status">{c.blocked ? <Badge tone="danger">Blocked</Badge> : <Badge tone="ok">Active</Badge>}</Detail>
      </dl>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="label-caps">Notes</h3>
          <button type="button" onClick={onEdit} className="rounded px-1.5 text-xs text-fg-3 hover:bg-hover hover:text-fg">
            Edit
          </button>
        </div>
        {c.notes ? (
          <p className="whitespace-pre-wrap rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-5 text-fg-2" data-ph-mask>
            {c.notes}
          </p>
        ) : (
          <button
            type="button"
            onClick={onEdit}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-line px-3 py-2.5 text-left text-[12.5px] text-fg-4 hover:border-line-strong hover:text-fg-3"
          >
            <FileText className="size-3.5" />
            Add a note your team will see on every ticket
          </button>
        )}
      </section>

      {custom.length > 0 && (
        <section>
          <h3 className="label-caps mb-1">Custom fields</h3>
          <dl className="divide-y divide-line-soft">
            {custom.map(([k, v]) => (
              <Detail key={k} label={k} mono>
                {typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v)}
              </Detail>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function Tickets({ contactId }: { contactId: string }) {
  const { data, isLoading } = useQuery(q.contactTickets(contactId));
  if (isLoading)
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  if (!data?.length) return <EmptyState compact lit={0} title="No tickets yet" description="Conversations with this contact appear here." />;
  return (
    <ul className="py-1">
      {data.map((t) => (
        <li key={t.id}>
          <Link
            to="/inbox/$folder/{-$ticketId}"
            params={{ folder: "open", ticketId: t.id }}
            className="flex items-center gap-3 border-b border-line-soft px-5 py-2.5 hover:bg-hover/60"
          >
            <StatusIcon status={t.status} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]" data-ph-mask>
                {t.subject}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-fg-3">
                <TicketNumber n={t.number} />
                <span>{statusLabel[t.status]}</span>
                {t.assignee && <span className="truncate">· {t.assignee.name}</span>}
              </span>
            </span>
            <span className="mono shrink-0 text-[11px] text-fg-4">{relShort(t.last_message_at)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EditContact({ c, onDirty, onDeleted, onSaved }: { c: Contact; onDirty: (d: boolean) => void; onDeleted: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const [name, setName] = useState(c.name);
  const [email, setEmail] = useState(c.email ?? "");
  const [phone, setPhone] = useState(c.phone);
  const [notes, setNotes] = useState(c.notes);
  const [company, setCompany] = useState<CompanyRef | null>(c.company);
  const [blocked, setBlocked] = useState(c.blocked);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name !== c.name || email !== (c.email ?? "") || phone !== c.phone || notes !== c.notes || company?.id !== c.company?.id || blocked !== c.blocked;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  const save = useMutation({
    mutationFn: () =>
      api.contacts.update(c.id, {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim(),
        notes,
        company_id: company?.id ?? null,
        blocked,
      }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.contact(c.id) });
      const snap = snapshot(qc, [qk.contact(c.id), qk.contactLists]);
      patchContact(qc, { ...c, name: name.trim(), email: email.trim() || null, phone: phone.trim(), notes, company, blocked });
      return { snap };
    },
    onError: (e, _v, ctx) => {
      if (ctx) restore(qc, ctx.snap);
      setError(errorMessage(e));
    },
    onSuccess: (updated) => {
      patchContact(qc, updated);
      onDirty(false);
      toast.success("Contact saved");
      onSaved();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.contacts.remove(c.id),
    onSuccess: () => {
      dropContact(qc, c.id);
      qc.removeQueries({ queryKey: qk.contact(c.id) });
      toast.success("Contact deleted");
      onDeleted();
    },
  });

  return (
    <form
      className="flex flex-col gap-4 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() && !email.trim()) return setError("A contact needs a name or an email.");
        setError(null);
        save.mutate();
      }}
    >
      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Field label="Name">{(p) => <TextInput {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">{(p) => <TextInput {...p} type="email" className="mono" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Phone">{(p) => <TextInput {...p} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
        </div>
        <Field label="Company">{({ id }) => <CompanyPicker id={id} value={company} onChange={setCompany} />}</Field>
        <Field label="Notes" hint="Visible to your team on every ticket from this contact.">
          {(p) => <Textarea {...p} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2.5">
          <div>
            <div className="text-[13px] font-medium">Block contact</div>
            <div className="text-xs text-fg-3">New emails and chats from them go to spam.</div>
          </div>
          <Switch checked={blocked} onCheckedChange={setBlocked} aria-label="Block contact" disabled={!canEdit} />
        </div>
      </fieldset>
      {error && <p className="text-xs text-danger-fg">{error}</p>}
      {canEdit && (
        <div className="flex items-center justify-between border-t border-line-soft pt-4">
          <Button
            variant="danger"
            icon={<Trash2 className="size-3.5" />}
            onClick={() =>
              confirm.show(
                "Their tickets stay, but the contact record and its notes are removed.",
                () => remove.mutateAsync(),
                { title: `Delete ${c.name || c.email || "this contact"}?`, confirmLabel: "Delete contact", danger: true },
              )
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
