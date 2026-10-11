import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { MoreHorizontal, Plus, Power, Trash2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SettingsPage, Section, ListRow, NoAccess } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { SkeletonRows } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { MailboxIcon, MailboxStatus, kindLabel } from "@/components/mailboxes/kinds";
import { useMailboxActions } from "@/components/mailboxes/useMailboxActions";
import { relLong } from "@/lib/format";
import { q } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";
import { PlanLimitHint, showLimit } from "@/components/billing/PlanLimit";
import { useLimit } from "@/components/billing/hooks";

/** "Add mailbox", or the upgrade prompt when Free's one mailbox is taken. */
function AddMailboxButton({ children }: { children: React.ReactNode }) {
  const limit = useLimit("mailboxes");
  if (limit.atLimit)
    return (
      <Button variant="primary" onClick={() => showLimit("mailboxes", limit.max)}>
        <Plus className="size-3.5" />
        {children}
      </Button>
    );
  return (
    <Button variant="primary" asChild>
      <Link to="/settings/mailboxes/new">
        <Plus className="size-3.5" />
        {children}
      </Link>
    </Button>
  );
}

const oauthErrors: Record<string, string> = {
  access_denied: "The connection was cancelled.",
  invalid_state: "The connection expired. Try again.",
  provider_error: "The provider returned an error. Try again.",
  provider_unavailable: "That provider isn't set up on this server.",
};

export default function Mailboxes() {
  const role = useRole();
  const navigate = useNavigate();
  const search = useSearch({ from: "/app/settings/mailboxes" });
  const { data, isLoading } = useQuery({ ...q.mailboxes(), enabled: atLeast(role, "admin") });
  const { setStatus, test, remove, testDialog } = useMailboxActions();
  const [highlight, setHighlight] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || (!search.connected && !search.error)) return;
    handled.current = true;
    if (search.connected) {
      toast.success("Mailbox connected");
      setHighlight(search.connected);
      setTimeout(() => setHighlight(null), 2400);
    } else if (search.error) toast.error(oauthErrors[search.error] ?? "The mailbox couldn't be connected.");
    void navigate({ to: "/settings/mailboxes", search: {}, replace: true });
  }, [search.connected, search.error, navigate]);

  if (!atLeast(role, "admin"))
    return (
      <SettingsPage title="Mailboxes">
        <NoAccess what="mailboxes" />
      </SettingsPage>
    );

  return (
    <SettingsPage
      title="Mailboxes"
      description="Email addresses whose mail becomes tickets. Replies go out from the same address."
      actions={<AddMailboxButton>Add mailbox</AddMailboxButton>}
    >
      <PlanLimitHint kind="mailboxes" className="-mt-3" />
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : !data?.length ? (
        <Section>
          <EmptyState
            lit={1}
            title="No mailboxes yet"
            description="Connect Gmail or Microsoft 365, forward from any provider, or use IMAP and SMTP."
            action={<AddMailboxButton>Add a mailbox</AddMailboxButton>}
          />
        </Section>
      ) : (
        <Section flush>
          {data.map((m) => (
            <ListRow
              key={m.id}
              onClick={() => void navigate({ to: "/settings/mailboxes/$mailboxId", params: { mailboxId: m.id } })}
              className={cn("transition-colors duration-700", highlight === m.id && "bg-hover")}
            >
              <MailboxIcon kind={m.inbound_kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{m.name}</div>
                <div className="mono truncate text-xs text-fg-3">{m.email}</div>
              </div>
              <span className="hidden w-28 text-xs text-fg-3 lg:block">{kindLabel[m.inbound_kind]}</span>
              <div className="hidden w-32 sm:block">
                <MailboxStatus mailbox={m} />
              </div>
              <span className="mono hidden w-28 whitespace-nowrap text-right text-[11px] text-fg-4 md:block">
                {m.last_synced_at ? relLong(m.last_synced_at) : m.inbound_kind === "forwarding" ? "" : "Never synced"}
              </span>
              <Menu>
                <MenuTrigger asChild>
                  <Button size="sm" variant="ghost" square aria-label={`Actions for ${m.email}`} onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuItem icon={<Zap />} onSelect={() => void test(m)}>
                    Test connection
                  </MenuItem>
                  <MenuItem icon={<Power />} onSelect={() => setStatus.mutate({ m, status: m.status === "disabled" ? "active" : "disabled" })}>
                    {m.status === "disabled" ? "Enable" : "Disable"}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 />} onSelect={() => remove(m)}>
                    Remove
                  </MenuItem>
                </MenuContent>
              </Menu>
            </ListRow>
          ))}
        </Section>
      )}
      {testDialog}
    </SettingsPage>
  );
}
