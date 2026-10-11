import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Building2, Plus, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Field, SearchInput, TextInput } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { DirectoryNav } from "@/components/contacts/DirectoryNav";
import { ContactDrawer } from "@/components/contacts/ContactDrawer";
import { CompanyPicker } from "@/components/contacts/CompanyPicker";
import { useDebounced, useSentinel } from "@/components/contacts/hooks";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { CompanyRef } from "@/lib/api/types";
import { relShort } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

const route = getRouteApi("/app/contacts/{-$contactId}");

const cols = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_72px_80px] items-center gap-4";

export default function ContactsPage() {
  const search = route.useSearch();
  const { contactId } = route.useParams();
  const navigate = route.useNavigate();
  const role = useRole();
  const [term, setTerm] = useState(search.q ?? "");
  const debounced = useDebounced(term, 250);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if ((debounced || undefined) === search.q) return;
    void navigate({ search: (s) => ({ ...s, q: debounced || undefined }), replace: true });
  }, [debounced, search.q, navigate]);

  const list = useInfiniteQuery(q.contacts({ q: search.q, company_id: search.company }));
  const company = useQuery({ ...q.company(search.company ?? ""), enabled: !!search.company });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const sentinel = useSentinel(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, !!list.hasNextPage);

  const open = (id: string | undefined) =>
    navigate({ to: "/contacts/{-$contactId}", params: { contactId: id }, search: (s) => s });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Contacts"
        icon={<Users />}
        actions={
          atLeast(role, "agent") ? (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
              New contact
            </Button>
          ) : undefined
        }
      >
        <DirectoryNav current="contacts" />
        <div className="ml-auto w-[260px]">
          <SearchInput value={term} onChange={setTerm} placeholder="Search name, email or company" />
        </div>
      </PageHeader>

      {search.company && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft px-4">
          <span className="text-xs text-fg-3">Filtered by</span>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-line bg-surface pl-2 pr-0.5 text-xs">
            <Building2 className="size-3 text-fg-3" />
            {company.data?.name ?? "Company"}
            <button
              type="button"
              aria-label="Clear company filter"
              onClick={() => void navigate({ search: (s) => ({ ...s, company: undefined }) })}
              className="flex size-5 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-fg"
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${cols} sticky top-0 z-10 h-8 border-b border-line bg-surface/95 px-4 backdrop-blur`}>
          <span className="label-caps">Name</span>
          <span className="label-caps">Email</span>
          <span className="label-caps">Company</span>
          <span className="label-caps text-right">Tickets</span>
          <span className="label-caps text-right">Updated</span>
        </div>

        {list.isLoading ? (
          <SkeletonRows rows={10} />
        ) : rows.length === 0 ? (
          <EmptyState
            lit={2}
            title={search.q ? "No contacts match" : "No contacts yet"}
            description={
              search.q
                ? "Try a different name, email or company."
                : "Contacts are created when customers email or chat with you. You can also add one yourself."
            }
            action={
              search.q ? (
                <Button onClick={() => setTerm("")}>Clear search</Button>
              ) : atLeast(role, "agent") ? (
                <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                  New contact
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul role="list">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  to="/contacts/{-$contactId}"
                  params={{ contactId: c.id }}
                  search={(s) => s}
                  data-active={contactId === c.id || undefined}
                  className={`${cols} h-11 border-b border-line-soft px-4 text-[13px] transition-colors hover:bg-hover/60 data-[active]:bg-hover`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={c.name || c.email || "?"} src={c.avatar_url} size="md" />
                    <span className="truncate font-medium" data-ph-mask>
                      {c.name || <span className="text-fg-4">Unnamed</span>}
                    </span>
                    {c.blocked && <Badge tone="danger">Blocked</Badge>}
                  </span>
                  <span className="mono truncate text-xs text-fg-2" data-ph-mask>
                    {c.email ?? <span className="text-fg-4">–</span>}
                  </span>
                  <span className="truncate text-fg-2">{c.company?.name ?? <span className="text-fg-4">–</span>}</span>
                  <span className="mono text-right text-xs tabular-nums text-fg-2">{c.ticket_count}</span>
                  <span className="mono text-right text-[11px] text-fg-3">{relShort(c.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div ref={sentinel} className="flex h-12 items-center justify-center">
          {list.isFetchingNextPage && <Spinner className="size-3.5 text-fg-4" />}
        </div>
      </div>

      <ContactDrawer contactId={contactId ?? null} onClose={() => void open(undefined)} />
      <NewContactDialog open={creating} onOpenChange={setCreating} onCreated={(id) => void open(id)} defaultCompany={company.data ?? null} />
    </div>
  );
}

function NewContactDialog({
  open,
  onOpenChange,
  onCreated,
  defaultCompany,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
  defaultCompany: CompanyRef | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState<CompanyRef | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPhone("");
      setError(null);
      setCompany(defaultCompany ? { id: defaultCompany.id, name: defaultCompany.name, domain: defaultCompany.domain } : null);
    }
  }, [open, defaultCompany]);

  const create = useMutation({
    mutationFn: () =>
      api.contacts.create({ name: name.trim(), email: email.trim() || null, phone: phone.trim(), company_id: company?.id ?? null }),
    onSuccess: (c) => {
      qc.setQueryData(qk.contact(c.id), c);
      void qc.invalidateQueries({ queryKey: qk.contactLists });
      toast.success("Contact created");
      onOpenChange(false);
      onCreated(c.id);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() && !email.trim()) return setError("Add a name or an email.");
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("That email doesn't look right.");
    setError(null);
    create.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New contact"
      footer={
        <>
          {error && <p className="mr-auto text-xs text-danger-fg">{error}</p>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-contact" loading={create.isPending}>
            Create contact
          </Button>
        </>
      }
    >
      <form id="new-contact" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name">{(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />}</Field>
        <Field label="Email">
          {(p) => <TextInput {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@example.com" className="mono" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" optional>
            {(p) => <TextInput {...p} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 20 7946 0000" />}
          </Field>
          <Field label="Company" optional>
            {({ id }) => <CompanyPicker id={id} value={company} onChange={setCompany} />}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
