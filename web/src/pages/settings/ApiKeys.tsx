import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { NoAccess, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty";
import { CopyField } from "@/components/ui/copy-button";
import { Tooltip } from "@/components/ui/tooltip";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useConfirm } from "@/components/ui/confirm";
import { ListSkeleton, MonoChip } from "@/components/settings2/bits";
import { useListMutation } from "@/components/settings2/optimistic";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { ApiKey } from "@/lib/api/types";
import { fullDate, relLong, shortDate } from "@/lib/format";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";

const scopeGroups: { resource: string; label: string; scopes: { id: string; label: string }[] }[] = [
  { resource: "tickets", label: "Tickets", scopes: [{ id: "tickets:read", label: "Read" }, { id: "tickets:write", label: "Write" }] },
  { resource: "contacts", label: "Contacts", scopes: [{ id: "contacts:read", label: "Read" }, { id: "contacts:write", label: "Write" }] },
  { resource: "kb", label: "Knowledge base", scopes: [{ id: "kb:read", label: "Read" }, { id: "kb:write", label: "Write" }] },
  { resource: "settings", label: "Settings", scopes: [{ id: "settings:read", label: "Read" }, { id: "settings:write", label: "Write" }] },
  { resource: "realtime", label: "Realtime", scopes: [{ id: "realtime", label: "Subscribe" }] },
];
const allScopes = scopeGroups.flatMap((g) => g.scopes.map((s) => s.id));
const readScopes = allScopes.filter((s) => s.endsWith(":read"));

type Expiry = "never" | "30" | "90" | "365";

export default function ApiKeys() {
  const role = useRole();
  const admin = atLeast(role, "admin");
  const { data: keys, isLoading } = useQuery({ ...q.apiKeys(), enabled: admin });
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<(ApiKey & { secret: string }) | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const revoke = useListMutation<ApiKey, string>(qk.apiKeys, (id) => api.apiKeys.remove(id), (rows, id) => rows.filter((k) => k.id !== id), {
    errorText: "Couldn't revoke the key",
  });
  const rename = useListMutation<ApiKey, { id: string; name: string }>(
    qk.apiKeys,
    (v) => api.apiKeys.update(v.id, { name: v.name }),
    (rows, v) => rows.map((k) => (k.id === v.id ? { ...k, name: v.name } : k)),
    { errorText: "Couldn't rename the key" },
  );

  if (!admin)
    return (
      <SettingsPage title="API keys">
        <NoAccess what="API keys" />
      </SettingsPage>
    );

  const sorted = [...(keys ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <SettingsPage
      title="API keys"
      description={
        <>
          Keys act on this workspace through the public API with only the scopes you give them. Send them as{" "}
          <span className="mono text-fg-2">Authorization: Bearer od_live_…</span>
        </>
      }
      actions={
        <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
          New key
        </Button>
      }
    >
      <Section flush>
        {isLoading ? (
          <ListSkeleton rows={3} />
        ) : !sorted.length ? (
          <EmptyState
            compact
            lit={2}
            icon={<KeyRound className="size-8 text-fg-4" strokeWidth={1.25} />}
            title="No API keys"
            description="Create a key to connect a script, an integration or your own backend."
            action={
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                New key
              </Button>
            }
          />
        ) : (
          sorted.map((k) => {
            const expired = !!k.expires_at && Date.parse(k.expires_at) < Date.now();
            return (
              <div key={k.id} className="group flex items-start gap-3 border-b border-line-soft px-4 py-3 last:border-0">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line text-fg-3">
                  <KeyRound className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {renaming === k.id ? (
                      <InlineName
                        initial={k.name}
                        onDone={(name) => {
                          setRenaming(null);
                          if (name && name !== k.name) rename.mutate({ id: k.id, name });
                        }}
                      />
                    ) : (
                      <span className="truncate text-[13px] font-medium">{k.name}</span>
                    )}
                    <span className="mono text-[11.5px] text-fg-3">{k.prefix}…</span>
                    {expired && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-danger-fg">
                        <span className="size-1.5 rounded-full bg-danger" /> Expired
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <MonoChip key={s}>{s}</MonoChip>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-3">
                    <Tooltip content={k.last_used_at ? fullDate(k.last_used_at) : "Never used"}>
                      <span>{k.last_used_at ? `Used ${relLong(k.last_used_at)}` : "Never used"}</span>
                    </Tooltip>
                    <span className="text-fg-4">·</span>
                    <span>{k.expires_at ? `${expired ? "Expired" : "Expires"} ${shortDate(k.expires_at)}` : "No expiry"}</span>
                    {k.created_by && (
                      <>
                        <span className="text-fg-4">·</span>
                        <span className="flex items-center gap-1.5">
                          <Avatar name={k.created_by.name} src={k.created_by.avatar_url} size="xs" />
                          {k.created_by.name}, {shortDate(k.created_at)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Menu>
                  <MenuTrigger asChild>
                    <button type="button" aria-label={`Actions for ${k.name}`} className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg">
                      <MoreHorizontal className="size-4" />
                    </button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<Pencil />} onSelect={() => setRenaming(k.id)}>
                      Rename
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem
                      danger
                      icon={<Trash2 />}
                      onSelect={() =>
                        confirm.show(
                          <>
                            Anything using <span className="font-medium text-fg">{k.name}</span> stops working right away. This can't be undone.
                          </>,
                          () => revoke.mutateAsync(k.id),
                          { title: "Revoke this key?", confirmLabel: "Revoke key", danger: true },
                        )
                      }
                    >
                      Revoke
                    </MenuItem>
                  </MenuContent>
                </Menu>
              </div>
            );
          })
        )}
      </Section>

      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(k) => {
            setCreating(false);
            setCreated(k);
          }}
        />
      )}
      <Dialog
        open={!!created}
        onOpenChange={(o) => !o && setCreated(null)}
        title="Copy your new key"
        description="This is the only time it's shown. Store it somewhere safe, like your secrets manager."
        footer={
          <Button variant="primary" onClick={() => setCreated(null)}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-1">
          <CopyField value={created?.secret ?? ""} />
          <p className="flex items-start gap-2 text-[12px] text-fg-3">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
            You won't see it again. If you lose it, revoke the key and make a new one.
          </p>
        </div>
      </Dialog>
    </SettingsPage>
  );
}

function InlineName({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const cancelled = useRef(false);
  return (
    <TextInput
      autoFocus
      inputSize="sm"
      value={v}
      maxLength={80}
      aria-label="Key name"
      className="max-w-[260px]"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(cancelled.current ? null : v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          cancelled.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (k: ApiKey & { secret: string }) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(readScopes);
  const [expiry, setExpiry] = useState<Expiry>("90");
  const [error, setError] = useState<string | null>(null);

  const preset = scopes.length === allScopes.length ? "full" : scopes.length === readScopes.length && readScopes.every((s) => scopes.includes(s)) ? "read" : "custom";

  const create = useMutation({
    mutationFn: () =>
      api.apiKeys.create({
        name: name.trim(),
        scopes,
        expires_at: expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 86400_000).toISOString(),
      }),
    onSuccess: (k) => {
      const { secret: _secret, ...row } = k;
      upsertInList(qc, qk.apiKeys, row as ApiKey, { prepend: true });
      onCreated(k);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const toggle = (id: string, on: boolean) => setScopes((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name the key so you know what uses it.");
    if (!scopes.length) return setError("Choose at least one scope.");
    create.mutate();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New API key"
      footer={
        <>
          <span className="mr-auto text-xs text-danger-fg">{error}</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            Create key
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name">
          {(p) => <TextInput {...p} autoFocus value={name} maxLength={80} placeholder="Zapier sync" onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium">Scopes</span>
            <Segmented
              size="xs"
              value={preset}
              onChange={(v) => {
                if (v === "read") setScopes(readScopes);
                if (v === "full") setScopes(allScopes);
              }}
              options={[
                { value: "read", label: "Read only" },
                { value: "full", label: "Full access" },
                { value: "custom", label: "Custom" },
              ]}
            />
          </div>
          <div className="rounded-md border border-line">
            {scopeGroups.map((g) => (
              <div key={g.resource} className="flex h-10 items-center gap-3 border-b border-line-soft px-3 last:border-0">
                <span className="flex-1 text-[12.5px] text-fg">{g.label}</span>
                {g.scopes.map((s) => (
                  <label key={s.id} className={cn("flex items-center gap-1.5 text-[12px]", scopes.includes(s.id) ? "text-fg" : "text-fg-3")}>
                    <Checkbox checked={scopes.includes(s.id)} onCheckedChange={(on) => toggle(s.id, on)} aria-label={`${g.label} ${s.label.toLowerCase()}`} />
                    {s.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        <Field label="Expires">
          {(p) => (
            <Select<Expiry>
              id={p.id}
              value={expiry}
              onChange={setExpiry}
              options={[
                { value: "30", label: "In 30 days" },
                { value: "90", label: "In 90 days" },
                { value: "365", label: "In a year" },
                { value: "never", label: "Never" },
              ]}
            />
          )}
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
