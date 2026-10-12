import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { RefreshCw, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { MailboxIcon, MailboxStatus, TestResults } from "@/components/mailboxes/kinds";
import { ForwardingInstructions } from "@/components/mailboxes/AddMailboxWizard";
import { useMailboxActions } from "@/components/mailboxes/useMailboxActions";
import { MailboxOllieSection } from "@/components/mailboxes/MailboxOllie";
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
  ai_answers: boolean;
  ai_answers_mode: Mailbox["ai_answers_mode"];
  ai_answers_outside_hours: boolean;
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
    ai_answers: m.ai_answers ?? false,
    ai_answers_mode: m.ai_answers_mode ?? "draft",
    ai_answers_outside_hours: m.ai_answers_outside_hours ?? false,
    config: { ...m.config },
    password: "",
    smtp_password: "",
  };
}

export default function MailboxDetail() {
  const { t } = useTranslation("settingsChannels");
  const { mailboxId } = useParams({ from: "/app/settings/mailboxes/$mailboxId" });
  const back = <BackLink to="/settings/mailboxes">{t("detail.back")}</BackLink>;
  const role = useRole();
  const { data, isLoading } = useQuery({ ...q.mailboxes(), enabled: atLeast(role, "admin") });
  const mailbox = data?.find((m) => m.id === mailboxId);

  if (!atLeast(role, "admin"))
    return (
      <SettingsPage title={t("detail.fallbackTitle")} back={back}>
        <NoAccess what="mailboxes" />
      </SettingsPage>
    );
  if (isLoading)
    return (
      <SettingsPage title={<Skeleton className="h-5 w-48" />} back={back}>
        {[180, 220, 120].map((h, i) => (
          <div key={i} aria-hidden>
            <Skeleton className="mb-3 h-3 w-28" />
            <div className="rounded-lg border border-line px-4 py-4" style={{ height: h }}>
              <Skeleton className="h-2.5 w-32" />
              <Skeleton className="mt-2.5 h-2 w-[55%] opacity-60" />
            </div>
          </div>
        ))}
      </SettingsPage>
    );
  if (!mailbox)
    return (
      <SettingsPage title={t("detail.fallbackTitle")} back={back}>
        <Section flush>
          <EmptyState
            lit={3}
            title={t("detail.notFound")}
            description={t("detail.notFoundBody")}
            action={
              <Button size="sm" asChild>
                <Link to="/settings/mailboxes">{t("detail.backToList")}</Link>
              </Button>
            }
          />
        </Section>
      </SettingsPage>
    );
  return <MailboxEditor key={mailbox.id} mailbox={mailbox} />;
}

function MailboxEditor({ mailbox }: { mailbox: Mailbox }) {
  const { t } = useTranslation("settingsChannels");
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
        team_id: draft.team_id ?? "", // "" clears the team; null would mean "unchanged"
        signature_html: draft.signature_html,
        auto_reply_enabled: draft.auto_reply_enabled,
        auto_reply_subject: draft.auto_reply_subject.trim(),
        auto_reply_html: draft.auto_reply_html,
        // Only what changed, so saving other fields never needs AI on.
        ...(draft.ai_answers !== base.ai_answers ? { ai_answers: draft.ai_answers } : {}),
        ...(draft.ai_answers_mode !== base.ai_answers_mode ? { ai_answers_mode: draft.ai_answers_mode } : {}),
        ...(draft.ai_answers_outside_hours !== base.ai_answers_outside_hours ? { ai_answers_outside_hours: draft.ai_answers_outside_hours } : {}),
        ...(mailbox.inbound_kind === "imap" ? { config: draft.config } : {}),
        ...(draft.password ? { password: draft.password } : {}),
        ...(draft.smtp_password ? { smtp_password: draft.smtp_password } : {}),
      }),
    onSuccess: (m) => {
      upsertInList(qc, qk.mailboxes, m);
      setDraft(toDraft(m));
      toast.success(t("detail.saved"));
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
      toast.error(errorMessage(e, t("detail.testRunFailed")));
    } finally {
      setTesting(false);
    }
  };

  const oauth = mailbox.inbound_kind === "google" || mailbox.inbound_kind === "microsoft";

  return (
    <SettingsPage
      back={<BackLink to="/settings/mailboxes">{t("detail.back")}</BackLink>}
      title={
        <span className="flex items-center gap-3">
          <MailboxIcon kind={mailbox.inbound_kind} size="lg" />
          <span className="min-w-0">
            <span className="block truncate">{mailbox.name}</span>
            <span className="mono block truncate text-[12.5px] font-normal tracking-normal text-fg-3">{mailbox.email}</span>
          </span>
        </span>
      }
      actions={<MailboxStatus mailbox={mailbox} />}
    >
      <Section
        title={t("detail.connection")}
        description={t(`kind.${mailbox.inbound_kind}`)}
        actions={
          <Button size="sm" icon={<Zap className="size-3.5" />} loading={testing} onClick={runTest}>
            {t("detail.testConnection")}
          </Button>
        }
      >
        {mailbox.status === "error" && mailbox.last_error && (
          <div className="-mx-4 border-b border-tone-red-line bg-tone-red-soft px-4 py-3" role="alert">
            <div className="flex items-start gap-2.5 text-[12.5px]">
              <span className="mt-1.5 size-1.5 shrink-0 animate-pulse-soft rounded-full bg-tone-red-solid motion-reduce:animate-none" />
              <div className="min-w-0">
                <div className="font-medium text-tone-red">{t("detail.lastSyncFailed")}</div>
                <div className="mono mt-0.5 break-words text-xs text-fg-2">{mailbox.last_error}</div>
              </div>
            </div>
          </div>
        )}
        {test && (
          <div className="border-b border-line-soft py-3.5">
            <TestResults result={test} />
          </div>
        )}
        <Row label={t("detail.lastSynced")} description={mailbox.inbound_kind === "forwarding" ? t("detail.forwardingInstant") : undefined}>
          <span className="mono text-xs text-fg-3">{mailbox.last_synced_at ? relLong(mailbox.last_synced_at) : t("detail.never")}</span>
        </Row>
        {oauth && (
          <Row label={t("detail.account")} description={t("detail.accountHint", { provider: t(`kind.${mailbox.inbound_kind}`) })}>
            <span className="mono text-xs text-fg-2">{mailbox.config.oauth_email ?? mailbox.email}</span>
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={reconnect.isPending} onClick={() => reconnect.mutate()}>
              {t("detail.reconnect")}
            </Button>
          </Row>
        )}
        {mailbox.inbound_kind === "forwarding" && (
          <div className="py-3.5">
            <ForwardingInstructions mailbox={mailbox} />
          </div>
        )}
        {mailbox.inbound_kind === "imap" && (
          <div className="grid gap-4 py-4 lg:grid-cols-2">
            <ServerEdit
              title={t("detail.incoming")}
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
              title={t("detail.outgoing")}
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

      <Section title={t("detail.sending")} description={t("detail.sendingHint")}>
        <Row label={t("detail.name")} description={t("detail.nameHint")} htmlFor="mb-name">
          <TextInput id="mb-name" className="w-[260px]" value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </Row>
        <Row label={t("detail.senderName")} description={t("detail.senderNameHint")} htmlFor="mb-display">
          <TextInput id="mb-display" className="w-[260px]" value={draft.display_name} placeholder={mailbox.name} onChange={(e) => set("display_name", e.target.value)} />
        </Row>
        <Row label={t("detail.team")} description={t("detail.teamHint")}>
          <Select
            className="w-[260px]"
            aria-label={t("detail.team")}
            value={draft.team_id ?? "__none"}
            onChange={(v) => set("team_id", v === "__none" ? null : v)}
            options={[{ value: "__none", label: t("detail.noTeam") }, ...(teams ?? []).map((t) => ({ value: t.id, label: t.name }))]}
          />
        </Row>
        {mailbox.outbound_kind === "system" && (
          <Row label={t("detail.sentFrom")} description={t("detail.sentFromHint")}>
            <span className="mono text-xs text-fg-3">opendesk</span>
          </Row>
        )}
      </Section>

      <Section title={t("detail.signature")} description={t("detail.signatureHint")}>
        <div className="-mx-4 -my-1">
          <RichEditor
            value={draft.signature_html}
            onChange={(v) => set("signature_html", v)}
            placeholder={t("detail.signaturePlaceholder")}
            ariaLabel={t("detail.signature")}
            contentClassName="min-h-[88px]"
          />
        </div>
      </Section>

      <Section title={t("detail.autoReply")} description={t("detail.autoReplyHint")}>
        <Row label={t("detail.autoReplyToggle")}>
          <Switch aria-label={t("detail.autoReplyToggle")} checked={draft.auto_reply_enabled} onCheckedChange={(v) => set("auto_reply_enabled", v)} />
        </Row>
        {draft.auto_reply_enabled && (
          <div className="flex flex-col gap-3 py-3.5">
            <Field label={t("detail.subject")}>
              {({ id }) => (
                <TextInput id={id} value={draft.auto_reply_subject} placeholder={t("detail.subjectPlaceholder")} onChange={(e) => set("auto_reply_subject", e.target.value)} />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium">{t("detail.message")}</span>
              <div className="rounded-md border border-line focus-within:border-fg-3 focus-within:shadow-[0_0_0_3px_var(--focus)]">
                <RichEditor
                  value={draft.auto_reply_html}
                  onChange={(v) => set("auto_reply_html", v)}
                  placeholder={t("detail.messagePlaceholder")}
                  ariaLabel={t("detail.autoReplyLabel")}
                  contentClassName="min-h-[100px]"
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      <MailboxOllieSection value={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} />

      <Section title={t("detail.danger")} danger>
        <Row
          label={mailbox.status === "disabled" ? t("detail.enableTitle") : t("detail.disableTitle")}
          description={mailbox.status === "disabled" ? t("detail.enableHint") : t("detail.disableHint")}
        >
          <Button
            variant="danger"
            loading={setStatus.isPending}
            onClick={() => setStatus.mutate({ m: mailbox, status: mailbox.status === "disabled" ? "active" : "disabled" })}
          >
            {mailbox.status === "disabled" ? t("detail.enable") : t("detail.disable")}
          </Button>
        </Row>
        <Row label={t("detail.removeTitle")} description={t("detail.removeHint")}>
          <Button variant="danger" onClick={() => remove(mailbox, () => void navigate({ to: "/settings/mailboxes" }))}>
            {t("detail.remove")}
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
  const { t } = useTranslation("settingsChannels");
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-sunken/50 p-3.5">
      <legend className="px-1 text-[12.5px] font-medium">{p.title}</legend>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label={t("detail.server")}>{({ id }) => <TextInput id={id} className="mono" value={p.host} onChange={(e) => p.onHost(e.target.value)} />}</Field>
        <Field label={t("detail.port")}>{({ id }) => <NumberInput id={id} value={p.port} min={1} max={65535} onChange={p.onPort} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Field label={t("detail.username")}>{({ id }) => <TextInput id={id} className="mono" autoComplete="off" value={p.username} onChange={(e) => p.onUsername(e.target.value)} />}</Field>
        <Field label={t("detail.password")} hint={t("detail.passwordKeep")}>
          {({ id }) => <TextInput id={id} type="password" autoComplete="new-password" value={p.password} placeholder="••••••••" onChange={(e) => p.onPassword(e.target.value)} />}
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium">{t("detail.security")}</span>
        <Segmented
          size="xs"
          value={p.tls}
          onChange={p.onTls}
          options={[
            { value: "tls", label: "TLS" },
            { value: "starttls", label: "STARTTLS" },
            { value: "none", label: t("detail.tlsNone") },
          ]}
        />
      </div>
    </fieldset>
  );
}
