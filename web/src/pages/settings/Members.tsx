import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut, MoreHorizontal, UserMinus, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { SettingsPage, Section, ListRow } from "@/components/layout";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { SkeletonRows } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import type { Invitation, Member, Role } from "@/lib/api/types";
import { relLong, shortDate } from "@/lib/format";
import { q, qk, removeFromList } from "@/lib/queries";
import { atLeast, reloadSession, useRole, useSession } from "@/lib/session";
import { cn } from "@/lib/cn";
import { PlanLimitHint, showLimit } from "@/components/billing/PlanLimit";
import { useLimit } from "@/components/billing/hooks";

const roleLabel: Record<Role, string> = { owner: "Owner", admin: "Admin", agent: "Agent", viewer: "Viewer" };
const roleHint: Record<Exclude<Role, "owner">, string> = {
  admin: "Manages settings, mailboxes and members",
  agent: "Works tickets, contacts and articles",
  viewer: "Reads everything, changes nothing",
};

/** Which roles `me` may hand out, and whether they may manage `target` at all. */
function grantable(me: Role): Exclude<Role, "owner">[] {
  if (me === "owner") return ["admin", "agent", "viewer"];
  if (me === "admin") return ["agent", "viewer"];
  return [];
}
function canManage(me: Role, meId: string, target: Member) {
  if (target.user.id === meId || target.role === "owner") return false;
  if (me === "owner") return true;
  return me === "admin" && (target.role === "agent" || target.role === "viewer");
}

export default function Members() {
  const role = useRole();
  const [inviteOpen, setInviteOpen] = useState(false);
  const limit = useLimit("members");
  return (
    <SettingsPage
      title="Members"
      description="Everyone who can sign in to this workspace."
      actions={
        atLeast(role, "admin") && (
          <Button
            variant="primary"
            icon={<UserPlus className="size-3.5" />}
            onClick={() => (limit.atLimit ? showLimit("members", limit.max) : setInviteOpen(true))}
          >
            Invite people
          </Button>
        )
      }
    >
      {atLeast(role, "admin") && <PlanLimitHint kind="members" className="-mt-3" />}
      <MembersList />
      {atLeast(role, "admin") && <Invitations />}
      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
    </SettingsPage>
  );
}

function MembersList() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const role = useRole();
  const meId = useSession((s) => s.user!.id);
  const { data, isLoading } = useQuery(q.members());

  const patchMembers = (fn: (m: Member[]) => Member[]) => {
    const prev = qc.getQueryData<Member[]>(qk.members);
    if (prev) qc.setQueryData(qk.members, fn(prev));
    return { prev };
  };

  const changeRole = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: Role }) => api.members.update(uid, role),
    onMutate: async ({ uid, role }) => {
      await qc.cancelQueries({ queryKey: qk.members });
      return patchMembers((list) => list.map((m) => (m.user.id === uid ? { ...m, role } : m)));
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.members, ctx.prev);
      toast.error(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.members }),
  });

  const remove = async (m: Member) => {
    const { prev } = patchMembers((list) => list.filter((x) => x.user.id !== m.user.id));
    try {
      await api.members.remove(m.user.id);
      void qc.invalidateQueries({ queryKey: qk.billing, exact: true });
      toast.success(`${m.user.name} removed`);
    } catch (e) {
      if (prev) qc.setQueryData(qk.members, prev);
      throw e;
    }
  };

  const leave = () =>
    confirm.show(
      "You lose access to every ticket and setting in this workspace. An admin can invite you back.",
      async () => {
        try {
          await api.members.remove(meId);
        } catch (e) {
          if (isApiError(e, "owner_cannot_leave")) throw new Error("Transfer ownership before you leave.", { cause: e });
          throw e;
        }
        qc.clear();
        const s = await reloadSession();
        void navigate(s.workspaceId ? { to: "/" } : { to: "/onboarding" });
      },
      { title: "Leave this workspace?", confirmLabel: "Leave", danger: true },
    );

  const sorted = [...(data ?? [])].sort((a, b) => {
    const r = { owner: 0, admin: 1, agent: 2, viewer: 3 } as const;
    return r[a.role] - r[b.role] || a.user.name.localeCompare(b.user.name);
  });

  return (
    <Section
      flush
      title={data ? `${data.length} ${data.length === 1 ? "member" : "members"}` : "Members"}
      actions={
        role !== "owner" && (
          <Button size="sm" variant="ghost" icon={<LogOut className="size-3.5" />} onClick={leave}>
            Leave workspace
          </Button>
        )
      }
    >
      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : (
        sorted.map((m) => {
          const manageable = canManage(role, meId, m);
          return (
            <ListRow key={m.user.id}>
              <Avatar name={m.user.name || m.user.email} src={m.user.avatar_url} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="truncate">{m.user.name}</span>
                  {m.user.id === meId && <span className="text-xs font-normal text-fg-4">You</span>}
                </div>
                <div className="mono truncate text-xs text-fg-3">{m.user.email}</div>
              </div>
              <span className="hidden w-32 whitespace-nowrap text-xs text-fg-3 sm:block">Joined {shortDate(m.created_at)}</span>
              <div className="w-[120px]">
                {manageable ? (
                  <Select
                    size="sm"
                    aria-label={`Role for ${m.user.name}`}
                    value={m.role}
                    onChange={(v) => changeRole.mutate({ uid: m.user.id, role: v })}
                    options={grantable(role)
                      .concat(m.role === "admin" && role !== "owner" ? ["admin"] : [])
                      .map((r) => ({ value: r, label: roleLabel[r] }))}
                  />
                ) : (
                  <span className="flex h-7 items-center px-2.5 text-[12.5px] text-fg-2">{roleLabel[m.role]}</span>
                )}
              </div>
              <div className="w-7">
                {manageable && (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="sm" variant="ghost" square aria-label={`Actions for ${m.user.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem
                        danger
                        icon={<UserMinus />}
                        onSelect={() =>
                          confirm.show(`${m.user.name} loses access right away. Their tickets stay, unassigned.`, () => remove(m), {
                            title: "Remove member?",
                            confirmLabel: "Remove",
                            danger: true,
                          })
                        }
                      >
                        Remove from workspace
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                )}
              </div>
            </ListRow>
          );
        })
      )}
    </Section>
  );
}

function Invitations() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery(q.invitations());

  const revoke = async (inv: Invitation) => {
    const prev = qc.getQueryData<Invitation[]>(qk.invitations);
    removeFromList(qc, qk.invitations, inv.id);
    try {
      await api.invitations.revoke(inv.id);
      void qc.invalidateQueries({ queryKey: qk.billing, exact: true });
    } catch (e) {
      if (prev) qc.setQueryData(qk.invitations, prev);
      throw e;
    }
  };

  if (isLoading) return <SkeletonRows rows={2} />;
  if (!data?.length) return null;

  return (
    <Section flush title="Pending invitations" description="Invitations expire after 7 days.">
      {data.map((inv) => {
        const expired = Date.parse(inv.expires_at) < Date.now();
        return (
          <ListRow key={inv.id}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed border-line-strong text-fg-4">
              <UserPlus className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="mono truncate text-[12.5px] text-fg">{inv.email}</div>
              <div className="text-xs text-fg-3">
                {inv.invited_by ? `Invited by ${inv.invited_by.name}` : "Invited"} {relLong(inv.created_at)}
              </div>
            </div>
            {expired ? <Badge tone="warn">Expired</Badge> : <span className="hidden text-xs text-fg-3 sm:block">Expires {shortDate(inv.expires_at)}</span>}
            <Badge tone="outline">{roleLabel[inv.role]}</Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                confirm.show(`The link sent to ${inv.email} stops working.`, () => revoke(inv), { title: "Revoke invitation?", confirmLabel: "Revoke" })
              }
            >
              Revoke
            </Button>
          </ListRow>
        );
      })}
    </Section>
  );
}

const emailRe = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function InviteDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const role = useRole();
  const options = grantable(role);
  const [emails, setEmails] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [inviteRole, setInviteRole] = useState<Exclude<Role, "owner">>("agent");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const bad = parts.filter((p) => !emailRe.test(p));
    const good = parts.filter((p) => emailRe.test(p));
    setEmails((cur) => Array.from(new Set([...cur, ...good])));
    setText(bad.join(" "));
    setError(bad.length ? `${bad[0]} doesn't look like an email address.` : null);
  };

  const send = async () => {
    const pending = text.trim() ? [...emails, ...text.split(/[\s,;]+/).filter((p) => emailRe.test(p.trim()))] : emails;
    if (!pending.length) return setError("Add at least one email address.");
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    let lastError: unknown = null;
    for (const email of pending) {
      try {
        await api.invitations.create({ email, role: inviteRole });
      } catch (e) {
        failed.push(email);
        lastError = e;
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: qk.invitations });
    void qc.invalidateQueries({ queryKey: qk.billing, exact: true });
    const sent = pending.length - failed.length;
    if (sent) toast.success(sent === 1 ? "Invitation sent" : `${sent} invitations sent`);
    if (failed.length) {
      setEmails(failed);
      setText("");
      setError(`${failed.join(", ")}: ${errorMessage(lastError)}`);
    } else onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Invite people"
      description="They get an email with a link to join. Links expire after 7 days."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={send}>
            Send invitations
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        <PlanLimitHint kind="members" compact />
        <Field label="Email addresses" hint="Separate addresses with commas or spaces." error={error}>
          {({ id }) => (
            <div
              className={cn(
                "flex min-h-[72px] flex-wrap content-start items-start gap-1 rounded-md border border-line bg-surface p-1.5 focus-within:border-fg-3 focus-within:shadow-[0_0_0_3px_var(--focus)]",
                error && "border-danger",
              )}
              onClick={() => document.getElementById(id)?.focus()}
            >
              {emails.map((e) => (
                <span key={e} className="mono inline-flex h-6 items-center gap-1 rounded-sm border border-line bg-hover pl-2 pr-0.5 text-xs">
                  {e}
                  <button
                    type="button"
                    aria-label={`Remove ${e}`}
                    onClick={() => setEmails((cur) => cur.filter((x) => x !== e))}
                    className="flex size-5 items-center justify-center rounded text-fg-3 hover:bg-active hover:text-fg"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                id={id}
                autoFocus
                value={text}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/[\s,;]$/.test(v)) commit(v);
                  else setText(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(text);
                  } else if (e.key === "Backspace" && !text && emails.length) setEmails((cur) => cur.slice(0, -1));
                }}
                onBlur={() => text.trim() && commit(text)}
                onPaste={(e) => {
                  e.preventDefault();
                  commit(text + " " + e.clipboardData.getData("text"));
                }}
                placeholder={emails.length ? "" : "name@company.com, another@company.com"}
                className="h-6 min-w-[180px] flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-fg-4"
              />
            </div>
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium">Role</span>
          <div role="radiogroup" aria-label="Role" className="flex flex-col gap-1.5">
            {options.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={inviteRole === r}
                onClick={() => setInviteRole(r)}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                  inviteRole === r ? "border-fg-3 bg-hover" : "border-line hover:border-line-strong",
                )}
              >
                <span className={cn("flex size-3.5 items-center justify-center rounded-full border", inviteRole === r ? "border-inverse" : "border-line-strong")}>
                  {inviteRole === r && <span className="size-1.5 rounded-full bg-inverse" />}
                </span>
                <span className="flex-1">
                  <span className="block text-[13px] font-medium">{roleLabel[r]}</span>
                  <span className="block text-xs text-fg-3">{roleHint[r]}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
