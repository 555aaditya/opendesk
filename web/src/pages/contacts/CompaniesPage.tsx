import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Building2, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Field, SearchInput, TextInput } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { DirectoryNav } from "@/components/contacts/DirectoryNav";
import { CompanyDrawer, CompanyGlyph } from "@/components/contacts/CompanyDrawer";
import { useDebounced, useSentinel } from "@/components/contacts/hooks";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import { relShort } from "@/lib/format";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

const route = getRouteApi("/app/companies/{-$companyId}");
const cols = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_88px_80px] items-center gap-4";

export default function CompaniesPage() {
  const search = route.useSearch();
  const { companyId } = route.useParams();
  const navigate = route.useNavigate();
  const role = useRole();
  const [term, setTerm] = useState(search.q ?? "");
  const debounced = useDebounced(term, 250);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if ((debounced || undefined) === search.q) return;
    void navigate({ search: (s) => ({ ...s, q: debounced || undefined }), replace: true });
  }, [debounced, search.q, navigate]);

  const list = useInfiniteQuery(q.companies({ q: search.q }));
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const sentinel = useSentinel(() => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  }, !!list.hasNextPage);
  const open = (id: string | undefined) => navigate({ to: "/companies/{-$companyId}", params: { companyId: id }, search: (s) => s });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Contacts"
        icon={<Building2 />}
        actions={
          atLeast(role, "agent") ? (
            <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
              New company
            </Button>
          ) : undefined
        }
      >
        <DirectoryNav current="companies" />
        <div className="ml-auto w-[260px]">
          <SearchInput value={term} onChange={setTerm} placeholder="Search companies or domains" />
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${cols} sticky top-0 z-10 h-8 border-b border-line bg-surface/95 px-4 backdrop-blur`}>
          <span className="label-caps">Company</span>
          <span className="label-caps">Domain</span>
          <span className="label-caps text-right">Contacts</span>
          <span className="label-caps text-right">Updated</span>
        </div>
        {list.isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            lit={0}
            title={search.q ? "No companies match" : "No companies yet"}
            description={search.q ? "Try a different name or domain." : "Group contacts by the organisation they work for."}
            action={
              search.q ? (
                <Button onClick={() => setTerm("")}>Clear search</Button>
              ) : atLeast(role, "agent") ? (
                <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                  New company
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul role="list">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  to="/companies/{-$companyId}"
                  params={{ companyId: c.id }}
                  search={(s) => s}
                  data-active={companyId === c.id || undefined}
                  className={`${cols} h-11 border-b border-line-soft px-4 text-[13px] transition-colors hover:bg-hover/60 data-[active]:bg-hover`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <CompanyGlyph name={c.name} />
                    <span className="truncate font-medium">{c.name}</span>
                  </span>
                  <span className="mono truncate text-xs text-fg-2">{c.domain || <span className="text-fg-4">–</span>}</span>
                  <span className="mono text-right text-xs tabular-nums text-fg-2">{c.contact_count}</span>
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

      <CompanyDrawer companyId={companyId ?? null} onClose={() => void open(undefined)} />
      <NewCompanyDialog open={creating} onOpenChange={setCreating} onCreated={(id) => void open(id)} />
    </div>
  );
}

function NewCompanyDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName("");
      setDomain("");
      setError(null);
    }
  }, [open]);
  const create = useMutation({
    mutationFn: () => api.companies.create({ name: name.trim(), domain: domain.trim().toLowerCase(), notes: "" }),
    onSuccess: (c) => {
      qc.setQueryData(qk.company(c.id), c);
      void qc.invalidateQueries({ queryKey: qk.companyLists });
      toast.success("Company created");
      onOpenChange(false);
      onCreated(c.id);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New company"
      size="sm"
      footer={
        <>
          {error && <p className="mr-auto text-xs text-danger-fg">{error}</p>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-company" loading={create.isPending}>
            Create company
          </Button>
        </>
      }
    >
      <form
        id="new-company"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Add a name.");
          setError(null);
          create.mutate();
        }}
      >
        <Field label="Name">{(p) => <TextInput {...p} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwind" />}</Field>
        <Field label="Domain" optional hint="Contacts with this email domain can be matched to the company.">
          {(p) => <TextInput {...p} className="mono" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="northwind.com" />}
        </Field>
      </form>
    </Dialog>
  );
}
