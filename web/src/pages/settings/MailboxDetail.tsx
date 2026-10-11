import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { RefreshCw, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BackLink, NoAccess, Row, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Field, NumberInput, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { RichEditor } from "@/components/editor/RichEditor";
import { SaveBar } from "@/components/settings/SaveBar";
import { MailboxIcon, MailboxStatus, TestResults, kindLabel } from "@/components/mailboxes/kinds";
import { ForwardingInstructions } from "@/components/mailboxes/AddMailboxWizard";
import { useMailboxActions } from "@/components/mailboxes/useMailboxActions";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Mailbox, MailboxConfig, MailboxTest, TlsMode } from "@/lib/api/types";
import { relLong } from "@/lib/format";
import { q, qk, upsertInList } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";

type Draft = {
  name: string;
  display_name: string;
  team_id: string | null;
  signature_html: string;
  auto_reply_enabled: boolean;
  auto_reply_subject: string;
  auto_reply_html: string;
  config: MailboxConfig;
  password: string;
  smtp_password: string;
};

function toDraft(m: Mailbox): Draft {
  return {
    name: m.name,
    display_name: m.display_name,
    team_id: m.team_id,
    signature_html: m.signature_html,
    auto_reply_enabled: m.auto_reply_enabled,
    auto_reply_subject: m.auto_reply_subject,
    auto_reply_html: m.auto_reply_html,
    config: { ...m.config },
    password: "",
    smtp_password: "",
  };
}

export default function MailboxDetail() {
  const { mailboxId } = useParams({ from: "/app/settings/mailboxes/$mailboxId" });
  const role = useRole();
  const { data, isLoading } = useQuery({ ...q.mailboxes(), enabled: atLeast(role, "admin") });
  const mailbox = data?.find((m) => m.id === mailboxId);

  if (!atLeast(role, "admin"))
    return (
      <SettingsPage title="Mailbox" back={<BackLink to="/settings/mailboxes">Mailboxes</BackLink>}>
        <NoAccess what="mailboxes" />
      </SettingsPage>
    );
  if (isLoading)
    return (
      <SettingsPage title={<Skeleton className="h-5 w-48" />} back={<BackLink to="/settings/mailboxes">Mailboxes</BackLink>}>
        <Skeleton className="h-40 w-full rounded-lg" />
      </SettingsPage>
    );
  if (!mailbox)
    return (
      <SettingsPage title="Mailbox" back={<BackLink to="/settings/mailboxes">Mailboxes</BackLink>}>
        <EmptyState lit={3} title="Mailbox not found" description="It may have been removed." />
      </SettingsPage>
    );
  return <MailboxEditor key={mailbox.id} mailbox={mailbox} />;
}

function MailboxEditor({ mailbox }: { mailbox: Mailbox }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: teams } = useQuery(q.teams());
  const { setStatus, remove, testDialog } = useMailboxActions();
  const base = useMemo(() => toDraft(mailbox), [mailbox]);
  const [draft, setDraft] = useState<Draft>(base);
  const [test, setTest] = useState<MailboxTest | null>(null);
  const [testing, setTesting] = useState(false);

  // Someone else saved: take their version unless we are mid-edit.
  const [prevBase, setPrevBase] = useState(base);
  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(prevBase)) setDraft(base);
    setPrevBase(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setCfg = <K extends keyof MailboxConfig>(k: K, v: MailboxConfig[K]) => setDraft((d) => ({ ...d, config: { ...d.config, [k]: v } }));

  const save = useMutation({
    mutationFn: () =>
      api.mailboxes.update(mailbox.id, {
        name: draft.name.trim(),
        display_name: draft.display_name.trim(),
        team_id: draft.team_id,
        signature_html: draft.signature_html,
        auto_reply_enabled: draft.auto_reply_enabled,
        auto_reply_subject: draft.auto_reply_subject.trim(),
        auto_reply_html: draft.auto_reply_html,
        ...(mailbox.inbound_kind === "imap" ? { config: draft.config } : {}),
        ...(draft.password ? { password: draft.password } : {}),
        ...(draft.smtp_password ? { smtp_password: draft.smtp_password } : {}),
      }),
    onSuccess: (m) => {
      upsertInList(qc, qk.mailboxes, m);
      setDraft(toDraft(m));
      toast.success("Mailbox saved");
    },
    onError: (e) => toast.error(e),
  });

  const reconnect = useMutation({
    mutationFn: () =>
      api.mailboxes.oauthStart(mailbox.inbound_kind === "microsoft" ? "microsoft" : "google", {
        mailbox_id: mailbox.id,
        name: mailbox.name,
        email: mailbox.email,
      }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => toast.error(e),
  });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.mailboxes.test(mailbox.id));
    } catch (e) {
      toast.error(errorMessage(e, "The test couldn't run"));
    } finally {
      setTesting(false);
    }
  };

  const oauth = mailbox.inbound_kind === "google" || mailbox.inbound_kind === "microsoft";

  return (
    <SettingsPage
      back={<BackLink to="/settings/mailboxes">Mailboxes</BackLink>}
      title={
        <span className="flex items-center gap-3">
          <MailboxIcon kind={mailbox.inbound_kind} />
          <span className="min-w-0">
            <span className="block truncate">{mailbox.name}</span>
            <span className="mono block truncate text-[12.5px] font-normal tracking-normal text-fg-3">{mailbox.email}</span>
          </span>
        </span>
      }
      actions={<MailboxStatus mailbox={mailbox} />}
    >
      <Section
        title="Connection"
        description={kindLabel[mailbox.inbound_kind]}
        actions={
          <Button size="sm" icon={<Zap className="size-3.5" />} loading={testing} onClick={runTest}>
            Test connection
          </Button>
        }
      >
        {mailbox.status === "error" && mailbox.last_error && (
          <div className="border-b border-line-soft py-3.5">
            <div className="flex items-start gap-2 text-[12.5px]">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-danger" />
              <div>
                <div className="font-medium">Last sync failed</div>
                <div className="mono mt-0.5 break-words text-xs text-fg-3">{mailbox.last_error}</div>
              </div>
            </div>
          </div>
        )}
        {test && (
          <div className="border-b border-line-soft py-3.5">
            <TestResults result={test} />
          </div>
        )}
        <Row label="Last synced" description={mailbox.inbound_kind === "forwarding" ? "Forwarded mail arrives as soon as it is sent." : undefined}>
          <span className="mono text-xs text-fg-3">{mailbox.last_synced_at ? relLong(mailbox.last_synced_at) : "Never"}</span>
        </Row>
        {oauth && (
          <Row label="Account" description={`Connected with ${kindLabel[mailbox.inbound_kind]}. Reconnect if access was revoked or the password changed.`}>
            <span className="mono text-xs text-fg-2">{mailbox.config.oauth_email ?? mailbox.email}</span>
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
              Reconnect
            </Button>
          </Row>
        )}
        {mailbox.inbound_kind === "forwarding" && (
          <div className="py-3.5">
            <ForwardingInstructions mailbox={mailbox} />
          </div>
        )}
        {mailbox.inbound_kind === "imap" && (
          <div className="flex flex-col gap-4 py-3.5">
            <ServerEdit
              title="Incoming (IMAP)"
              host={draft.config.imap_host ?? ""}
              port={draft.config.imap_port ?? 993}
              tls={draft.config.imap_tls ?? "tls"}
              username={draft.config.imap_username ?? ""}
              password={draft.password}
              onHost={(v) => setCfg("imap_host", v)}
              onPort={(v) => setCfg("imap_port", v)}
              onTls={(v) => setCfg("imap_tls", v)}
              onUsername={(v) => setCfg("imap_username", v)}
              onPassword={(v) => set("password", v)}
            />
            <ServerEdit
              title="Outgoing (SMTP)"
              host={draft.config.smtp_host ?? ""}
              port={draft.config.smtp_port ?? 587}
              tls={draft.config.smtp_tls ?? "starttls"}
              username={draft.config.smtp_username ?? ""}
              password={draft.smtp_password}
              onHost={(v) => setCfg("smtp_host", v)}
              onPort={(v) => setCfg("smtp_port", v)}
              onTls={(v) => setCfg("smtp_tls", v)}
              onUsername={(v) => setCfg("smtp_username", v)}
              onPassword={(v) => set("smtp_password", v)}
            />
          </div>
        )}
      </Section>

      <Section title="Sending">
        <Row label="Name" description="Shown to your team." htmlFor="mb-name">
          <TextInput id="mb-name" className="w-[260px]" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </Row>
        <Row label="Sender name" description="What customers see in the From line." htmlFor="mb-display">
          <TextInput id="mb-display" className="w-[260px]" value={draft.display_name} placeholder={mailbox.name} onChange={(e) => set("display_name", e.target.value)} />
        </Row>
        <Row label="Team" description="New tickets from this mailbox go to this team.">
          <Select
            className="w-[260px]"
            aria-label="Team"
            value={draft.team_id ?? "__none"}
            onChange={(v) => set("team_id", v === "__none" ? null : v)}
            options={[{ value: "__none", label: "No team" }, ...(teams ?? []).map((t) => ({ value: t.id, label: t.name }))]}
          />
        </Row>
        {mailbox.outbound_kind === "system" && (
          <Row label="Sent from" description="Replies go out from opendesk's sending address on behalf of this mailbox. Use IMAP and SMTP to send from your own server.">
            <span className="text-xs text-fg-3">opendesk</span>
          </Row>
        )}
      </Section>

      <Section title="Signature" description="Added below every reply sent from this mailbox.">
        <div className="-mx-4 -my-1">
          <RichEditor
            value={draft.signature_html}
            onChange={(v) => set("signature_html", v)}
            placeholder="The Support team at Company"
            ariaLabel="Signature"
            contentClassName="min-h-[88px]"
          />
        </div>
      </Section>

      <Section title="Auto-reply" description="Sent once when a customer opens a new ticket by email.">
        <Row label="Send an automatic reply">
          <Switch aria-label="Send an automatic reply" checked={draft.auto_reply_enabled} onCheckedChange={(v) => set("auto_reply_enabled", v)} />
        </Row>
        {draft.auto_reply_enabled && (
          <div className="flex flex-col gap-3 py-3.5">
            <Field label="Subject">
              {({ id }) => (
                <TextInput id={id} value={draft.auto_reply_subject} placeholder="We got your message" onChange={(e) => set("auto_reply_subject", e.target.value)} />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium">Message</span>
              <div className="rounded-md border border-line focus-within:border-fg-3 focus-within:shadow-[0_0_0_3px_var(--focus)]">
                <RichEditor
                  value={draft.auto_reply_html}
                  onChange={(v) => set("auto_reply_html", v)}
                  placeholder="Thanks for writing in. We usually reply within a few hours."
                  ariaLabel="Auto-reply message"
                  contentClassName="min-h-[100px]"
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Danger zone" danger>
        <Row
          label={mailbox.status === "disabled" ? "Enable mailbox" : "Disable mailbox"}
          description={mailbox.status === "disabled" ? "Start receiving and sending mail again." : "Stop syncing and sending without removing anything."}
        >
          <Button
            variant="danger"
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate({ m: mailbox, status: mailbox.status === "disabled" ? "active" : "disabled" })}
          >
            {mailbox.status === "disabled" ? "Enable" : "Disable"}
          </Button>
        </Row>
        <Row label="Remove mailbox" description="Existing tickets stay. New mail to this address stops arriving.">
          <Button variant="danger" onClick={() => remove(mailbox, () => void navigate({ to: "/settings/mailboxes" }))}>
            Remove
          </Button>
        </Row>
      </Section>

      {testDialog}
      <SaveBar dirty={dirty} saving={save.isPending} disabled={!draft.name.trim()} onSave={() => save.mutate()} onDiscard={() => setDraft(base)} />
    </SettingsPage>
  );
}

function ServerEdit(p: {
  title: string;
  host: string;
  port: number;
  tls: TlsMode;
  username: string;
  password: string;
  onHost: (v: string) => void;
  onPort: (v: number) => void;
  onTls: (v: TlsMode) => void;
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3.5">
      <legend className="px-1 text-[12.5px] font-medium">{p.title}</legend>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Server">{({ id }) => <TextInput id={id} className="mono" value={p.host} onChange={(e) => p.onHost(e.target.value)} />}</Field>
        <Field label="Port">{({ id }) => <NumberInput id={id} value={p.port} min={1} max={65535} onChange={p.onPort} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Username">{({ id }) => <TextInput id={id} className="mono" autoComplete="off" value={p.username} onChange={(e) => p.onUsername(e.target.value)} />}</Field>
        <Field label="Password" hint="Leave empty to keep the saved one.">
          {({ id }) => <TextInput id={id} type="password" autoComplete="new-password" value={p.password} placeholder="••••••••" onChange={(e) => p.onPassword(e.target.value)} />}
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium">Security</span>
        <Segmented
          size="xs"
          value={p.tls}
          onChange={p.onTls}
          options={[
            { value: "tls", label: "TLS" },
            { value: "starttls", label: "STARTTLS" },
            { value: "none", label: "None" },
          ]}
        />
      </div>
    </fieldset>
  );
}
