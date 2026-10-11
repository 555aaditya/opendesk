import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SettingsPage, Section, Row } from "@/components/layout";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { TextInput } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ReauthNotice } from "@/components/settings/ReauthNotice";
import { SaveBar } from "@/components/settings/SaveBar";
import { api } from "@/lib/api/endpoints";
import type { Workspace, WorkspaceSettings as WS } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";
import { atLeast, reloadSession, updateWorkspace, useRole, useSession } from "@/lib/session";
import { LOCALE_NAMES, matchLocale, SUPPORTED } from "@/i18n";

type Draft = { name: string; settings: Required<Pick<WS, "timezone" | "help_center_enabled" | "help_center_title" | "csat_enabled" | "auto_assign">> & { brand_color: string; locale: string } };

function toDraft(w: Workspace): Draft {
  return {
    name: w.name,
    settings: {
      timezone: w.settings.timezone ?? "UTC",
      help_center_enabled: w.settings.help_center_enabled ?? false,
      help_center_title: w.settings.help_center_title ?? "",
      csat_enabled: w.settings.csat_enabled ?? false,
      auto_assign: w.settings.auto_assign ?? "none",
      brand_color: w.settings.brand_color ?? "",
      locale: matchLocale(w.settings.locale) ?? "en",
    },
  };
}

const hexRe = /^#[0-9a-fA-F]{6}$/;

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
  }
}

export default function WorkspaceSettings() {
  const { data: ws } = useQuery(q.workspace());
  const role = useRole();
  const canEdit = atLeast(role, "admin");
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (ws) setDraft(toDraft(ws));
  }, [ws]);

  const tzItems = useMemo(() => timezones().map((t) => ({ value: t, label: t.replace(/_/g, " ") })), []);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      api.workspaces.update({
        name: d.name.trim(),
        settings: { ...d.settings, help_center_title: d.settings.help_center_title.trim(), brand_color: d.settings.brand_color || undefined },
      }),
    onMutate: async (d) => {
      await qc.cancelQueries({ queryKey: qk.workspace });
      const prev = qc.getQueryData<Workspace>(qk.workspace);
      if (prev) {
        const next = { ...prev, name: d.name.trim(), settings: { ...prev.settings, ...d.settings } };
        qc.setQueryData(qk.workspace, next);
        updateWorkspace(next);
      }
      return { prev };
    },
    onError: (e, _d, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(qk.workspace, ctx.prev);
        updateWorkspace(ctx.prev);
      }
      toast.error(e);
    },
    onSuccess: (w) => {
      qc.setQueryData(qk.workspace, w);
      updateWorkspace(w);
      toast.success("Workspace saved");
    },
  });

  if (!ws || !draft) {
    return (
      <SettingsPage title="General">
        <Skeleton className="h-40 w-full rounded-lg" />
      </SettingsPage>
    );
  }

  const base = toDraft(ws);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  const set = <K extends keyof Draft["settings"]>(k: K, v: Draft["settings"][K]) => setDraft({ ...draft, settings: { ...draft.settings, [k]: v } });
  const colorOk = !draft.settings.brand_color || hexRe.test(draft.settings.brand_color);
  const helpUrl = `${location.origin}/help/${ws.slug}`;

  return (
    <SettingsPage title="General" description="Settings that apply to everyone in this workspace.">
      <fieldset disabled={!canEdit} className="flex flex-col gap-8">
        <Section>
          <Row label="Workspace name" htmlFor="ws-name">
            <TextInput id="ws-name" className="w-[280px]" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Row>
          <Row label="Workspace URL" description="Used by the help center and the chat widget.">
            <span className="mono text-[12.5px] text-fg-2">{ws.slug}</span>
          </Row>
          <Row label="Timezone" description="Reports, SLA business days and timestamps in emails use it.">
            <Picker
              items={tzItems}
              value={draft.settings.timezone}
              onSelect={(v) => set("timezone", v)}
              placeholder="Search timezones"
              width={280}
              align="end"
              trigger={
                <Button disabled={!canEdit} className="w-[280px] justify-between font-normal" iconRight={<ChevronDown className="size-3.5 text-fg-3" />}>
                  <span className="truncate">{draft.settings.timezone.replace(/_/g, " ")}</span>
                </Button>
              }
            />
          </Row>
          <Row
            label="Customer language"
            description="The help center, satisfaction survey and chat widget follow each visitor's browser language. This one is used when we don't support theirs."
          >
            <Picker
              items={SUPPORTED.map((l) => ({ value: l, label: LOCALE_NAMES[l], keywords: [l] }))}
              value={draft.settings.locale}
              onSelect={(v) => set("locale", v)}
              placeholder="Search languages"
              width={220}
              align="end"
              trigger={
                <Button disabled={!canEdit} className="w-[220px] justify-between font-normal" iconRight={<ChevronDown className="size-3.5 text-fg-3" />}>
                  <span className="truncate">{LOCALE_NAMES[matchLocale(draft.settings.locale) ?? "en"]}</span>
                </Button>
              }
            />
          </Row>
        </Section>

        <Section title="Help center" description="A public site with your published knowledge base articles.">
          <Row label="Publish the help center" description={draft.settings.help_center_enabled ? "Anyone with the link can read published articles." : "Only your team can see articles."}>
            <Switch aria-label="Publish the help center" checked={draft.settings.help_center_enabled} onCheckedChange={(v) => set("help_center_enabled", v)} disabled={!canEdit} />
          </Row>
          <Row label="Title" htmlFor="hc-title">
            <TextInput
              id="hc-title"
              className="w-[280px]"
              placeholder={`${ws.name} Help`}
              value={draft.settings.help_center_title}
              maxLength={80}
              onChange={(e) => set("help_center_title", e.target.value)}
            />
          </Row>
          <Row label="Public address">
            <a href={helpUrl} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-[12.5px] text-fg-2 hover:text-fg">
              {helpUrl.replace(/^https?:\/\//, "")}
              <ExternalLink className="size-3" />
            </a>
            <CopyButton value={helpUrl} label="Copy link" />
          </Row>
        </Section>

        <Section title="Conversations">
          <Row label="Satisfaction survey" description="Ask customers to rate the conversation after a ticket is solved.">
            <Switch aria-label="Satisfaction survey" checked={draft.settings.csat_enabled} onCheckedChange={(v) => set("csat_enabled", v)} disabled={!canEdit} />
          </Row>
          <Row label="Auto-assign" description="Round robin spreads new tickets across agents who are online.">
            <Segmented
              value={draft.settings.auto_assign}
              onChange={(v) => canEdit && set("auto_assign", v)}
              options={[
                { value: "none", label: "Off" },
                { value: "round_robin", label: "Round robin" },
              ]}
            />
          </Row>
          <Row label="Brand colour" description="Used only by the chat widget and outgoing email buttons. The app itself stays monochrome.">
            <span
              aria-hidden
              className="size-6 rounded-md border border-line"
              style={{ background: colorOk && draft.settings.brand_color ? draft.settings.brand_color : "#0a0a0a" }}
            />
            <TextInput
              aria-label="Brand colour hex"
              className="mono w-[120px]"
              placeholder="#0A0A0A"
              value={draft.settings.brand_color}
              invalid={!colorOk}
              maxLength={7}
              onChange={(e) => {
                const v = e.target.value.trim();
                set("brand_color", v && !v.startsWith("#") ? `#${v}` : v);
              }}
            />
          </Row>
        </Section>
      </fieldset>

      {role === "owner" && <DangerZone ws={ws} />}

      <SaveBar
        dirty={dirty && canEdit}
        saving={save.isPending}
        disabled={!draft.name.trim() || !colorOk}
        onSave={() => save.mutate(draft)}
        onDiscard={() => setDraft(base)}
      />
    </SettingsPage>
  );
}

function DangerZone({ ws }: { ws: Workspace }) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useSession((s) => s.user!.id);
  const { data: members } = useQuery(q.members());
  const [transferTo, setTransferTo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const transfer = useMutation({
    mutationFn: (uid: string) => api.workspaces.transfer(uid),
    onSuccess: async () => {
      setTransferTo(null);
      await reloadSession(ws.id);
      void qc.invalidateQueries({ queryKey: qk.members });
      toast.success("Ownership transferred");
    },
  });

  const target = members?.find((m) => m.user.id === transferTo);

  return (
    <Section title="Danger zone" danger>
      <Row label="Transfer ownership" description="Make another member the owner. You become an admin.">
        <Picker
          items={(members ?? [])
            .filter((m) => m.user.id !== me && m.role !== "viewer")
            .map((m) => ({ value: m.user.id, label: m.user.name, hint: m.role, icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> }))}
          value={null}
          onSelect={(v) => {
            transfer.reset();
            setTransferTo(v);
          }}
          placeholder="Choose a member"
          align="end"
          trigger={<Button variant="danger">Transfer</Button>}
        />
      </Row>
      <Row label="Delete workspace" description="Removes every ticket, contact, article and setting. This can't be undone.">
        <Button
          variant="danger"
          onClick={() => {
            setError(null);
            confirm.show(
              `All of ${ws.name}'s data is removed for everyone. Members lose access immediately.`,
              async () => {
                try {
                  await api.workspaces.delete(ws.name);
                } catch (e) {
                  setError(e);
                  return;
                }
                qc.clear();
                const s = await reloadSession();
                void navigate(s.workspaceId ? { to: "/" } : { to: "/onboarding" });
              },
              { title: "Delete workspace?", confirmLabel: "Delete workspace", danger: true, typeToConfirm: ws.name },
            );
          }}
        >
          Delete workspace
        </Button>
      </Row>
      {!!error && (
        <div className="pb-3.5">
          <ReauthNotice error={error} />
        </div>
      )}
      {transferTo && target && (
        <Dialog
          open
          onOpenChange={(o) => !o && setTransferTo(null)}
          size="sm"
          title={`Make ${target.user.name} the owner?`}
          description="They get full control, including deleting the workspace. You stay on as an admin."
          footer={
            <>
              <Button variant="ghost" onClick={() => setTransferTo(null)}>
                Cancel
              </Button>
              <Button variant="danger-solid" loading={transfer.isPending} onClick={() => transfer.mutate(target.user.id)}>
                Transfer ownership
              </Button>
            </>
          }
        >
          {transfer.isError ? <ReauthNotice error={transfer.error} /> : <div />}
        </Dialog>
      )}
    </Section>
  );
}
