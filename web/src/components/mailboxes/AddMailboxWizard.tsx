import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, ChevronLeft, Forward, Server } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useConfirm } from "@/components/ui/confirm";
import { CopyField } from "@/components/ui/copy-button";
import { Field, NumberInput, TextInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/tabs";
import { api, type CreateMailboxBody } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { Mailbox, MailboxTest, TlsMode } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { q, qk, upsertInList } from "@/lib/queries";
import { tone } from "@/lib/tones";
import { GoogleGlyph, MicrosoftGlyph, TestResults, kindTone } from "./kinds";

export type Method = "google" | "microsoft" | "forwarding" | "imap";

const methods: { id: Method; icon: ReactNode; recommended?: boolean }[] = [
  { id: "google", icon: <GoogleGlyph className="size-[18px]" />, recommended: true },
  { id: "microsoft", icon: <MicrosoftGlyph className="size-[18px]" /> },
  { id: "forwarding", icon: <Forward className="size-[18px]" /> },
  { id: "imap", icon: <Server className="size-[18px]" /> },
];

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hostRe = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

type Form = {
  name: string;
  email: string;
  display_name: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_tls: TlsMode;
  smtp_same: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_tls: TlsMode;
  team_id: string;
};

const empty: Form = {
  name: "",
  email: "",
  display_name: "",
  imap_host: "",
  imap_port: 993,
  imap_username: "",
  imap_password: "",
  imap_tls: "tls",
  smtp_same: true,
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_tls: "starttls",
  team_id: "",
};

type Errors = Partial<Record<keyof Form, string>>;

type T = TFunction<"settingsChannels">;

function validate(method: Method, f: Form, t: T): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = t("wizard.err.name");
  if ((method === "forwarding" || method === "imap") && !emailRe.test(f.email.trim())) e.email = t("wizard.err.email");
  if ((method === "google" || method === "microsoft") && f.email.trim() && !emailRe.test(f.email.trim())) e.email = t("wizard.err.emailInvalid");
  if (method === "imap") {
    if (!hostRe.test(f.imap_host.trim())) e.imap_host = t("wizard.err.imapHost");
    if (!f.imap_username.trim()) e.imap_username = t("wizard.err.imapUser");
    if (!f.imap_password) e.imap_password = t("wizard.err.imapPassword");
    if (!hostRe.test(f.smtp_host.trim())) e.smtp_host = t("wizard.err.smtpHost");
    if (!f.smtp_same) {
      if (!f.smtp_username.trim()) e.smtp_username = t("wizard.err.smtpUser");
      if (!f.smtp_password) e.smtp_password = t("wizard.err.smtpPassword");
    }
  }
  return e;
}

const slide = {
  enter: (dir: number) => ({ x: dir * 16, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -16, opacity: 0 }),
};
const still = { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } };

export function AddMailboxWizard({
  onDone,
  onCancel,
  compact,
  extraFooter,
}: {
  onDone: (m: Mailbox | null) => void;
  onCancel?: () => void;
  compact?: boolean;
  extraFooter?: ReactNode;
}) {
  const { t } = useTranslation("settingsChannels");
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: teams } = useQuery(q.teams());
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [dir, setDir] = useState(1);
  const [method, setMethod] = useState<Method | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<Errors>({});
  const [blocked, setBlocked] = useState<string | null>(null);
  const [created, setCreated] = useState<Mailbox | null>(null);
  const [test, setTest] = useState<MailboxTest | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const go = (to: 0 | 1 | 2) => {
    setDir(to > step ? 1 : -1);
    setBlocked(null);
    setStep(to);
  };
  const dirty = step === 1 && JSON.stringify(form) !== JSON.stringify(empty);

  const oauth = useMutation({
    mutationFn: (provider: "google" | "microsoft") =>
      api.mailboxes.oauthStart(provider, { name: form.name.trim(), email: form.email.trim() || undefined }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e) => setBlocked(errorMessage(e)),
  });

  const create = useMutation({
    mutationFn: async () => {
      const f = form;
      const body: CreateMailboxBody =
        method === "forwarding"
          ? { name: f.name.trim(), email: f.email.trim(), display_name: f.display_name.trim() || undefined, inbound_kind: "forwarding", outbound_kind: "system", config: {}, team_id: f.team_id || null }
          : {
              name: f.name.trim(),
              email: f.email.trim(),
              display_name: f.display_name.trim() || undefined,
              inbound_kind: "imap",
              outbound_kind: "smtp",
              config: {
                imap_host: f.imap_host.trim(),
                imap_port: f.imap_port,
                imap_username: f.imap_username.trim(),
                imap_tls: f.imap_tls,
                smtp_host: f.smtp_host.trim(),
                smtp_port: f.smtp_port,
                smtp_username: (f.smtp_same ? f.imap_username : f.smtp_username).trim(),
                smtp_tls: f.smtp_tls,
              },
              password: f.imap_password,
              smtp_password: f.smtp_same ? f.imap_password : f.smtp_password,
              team_id: f.team_id || null,
            };
      const m = await api.mailboxes.create(body);
      upsertInList(qc, qk.mailboxes, m);
      setCreated(m);
      if (method === "imap") {
        try {
          setTest(await api.mailboxes.test(m.id));
        } catch {
          setTest(null);
        }
      }
      return m;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.mailboxes });
      go(2);
    },
    onError: (e) => setBlocked(errorMessage(e)),
  });

  const next = () => {
    if (step === 0) {
      if (!method) return setBlocked(t("wizard.chooseMethod"));
      return go(1);
    }
    if (step === 1 && method) {
      const e = validate(method, form, t);
      setErrors(e);
      if (Object.keys(e).length) return setBlocked(t("wizard.fixFields"));
      setBlocked(null);
      if (method === "google" || method === "microsoft") oauth.mutate(method);
      else create.mutate();
    }
  };

  const cancel = () => {
    if (!onCancel) return;
    if (!dirty) return onCancel();
    confirm.show(t("wizard.discardBody"), onCancel, { title: t("wizard.discardTitle"), confirmLabel: t("wizard.discard"), danger: true });
  };

  const busy = oauth.isPending || create.isPending;
  const primaryLabel =
    step === 0
      ? t("wizard.continue")
      : method === "google"
        ? t("wizard.continueGoogle")
        : method === "microsoft"
          ? t("wizard.continueMicrosoft")
          : method === "imap"
            ? t("wizard.connectTest")
            : t("wizard.create");

  const body = (
    <div className="relative overflow-hidden">
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          variants={reduce ? still : slide}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: reduce ? 0.1 : 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === 0 && (
            <div role="radiogroup" aria-label={t("wizard.methodsLabel")} className={cn("grid gap-2", !compact && "sm:grid-cols-2 sm:gap-2.5")}>
              {methods.map((m) => {
                const on = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setMethod(m.id);
                      setBlocked(null);
                    }}
                    onDoubleClick={() => {
                      setMethod(m.id);
                      go(1);
                    }}
                    className={cn(
                      "group relative flex items-start gap-3 rounded-lg border bg-surface p-3.5 text-left outline-none transition-[border-color,box-shadow,background-color,transform] duration-150 active:scale-[0.99] focus-visible:shadow-[0_0_0_3px_var(--focus)] motion-reduce:active:scale-100",
                      on ? "border-fg-2 shadow-[0_0_0_1px_var(--fg-2)]" : "border-line hover:border-line-strong hover:bg-sunken/60",
                    )}
                  >
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md", tone[kindTone[m.id]].chip)}>{m.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium">
                        {t(`wizard.${m.id}`)}
                        {m.recommended && <span className={cn("rounded-sm px-1.5 py-px text-[10.5px] font-medium", tone.green.chip)}>{t("wizard.recommended")}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs leading-[18px] text-fg-3">{t(`wizard.${m.id}Body`)}</span>
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                        on ? "border-inverse bg-inverse text-inverse-fg" : "border-line-strong",
                      )}
                    >
                      {on && <Check className="size-2.5 animate-indicator-in motion-reduce:animate-none" strokeWidth={3.5} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && method && <DetailsStep method={method} form={form} set={set} errors={errors} compact={compact} teams={teams ?? []} />}

          {step === 2 && created && <DoneStep mailbox={created} method={method!} test={test} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );

  const footer = (
    <>
      {step === 1 && (
        <Button variant="ghost" icon={<ChevronLeft className="size-3.5" />} onClick={() => go(0)} disabled={busy}>
          {t("wizard.back")}
        </Button>
      )}
      {step < 2 && onCancel && (
        <Button variant="ghost" onClick={cancel} disabled={busy}>
          {t("wizard.cancel")}
        </Button>
      )}
      {extraFooter}
      <div className="ml-auto flex items-center gap-2">
        {step < 2 ? (
          <Button variant="primary" onClick={next} loading={busy} iconRight={!busy && <ArrowRight className="size-3.5" />}>
            {primaryLabel}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => onDone(created)}>
            {t("wizard.done")}
          </Button>
        )}
      </div>
    </>
  );

  const error = blocked && (
    <p className="text-xs text-danger-fg" role="alert">
      {blocked}
    </p>
  );

  if (!compact)
    return (
      <div className="animate-rise-in overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <Stepper step={step} />
        <div className="px-5 py-5">
          {body}
          {error && <div className="mt-4">{error}</div>}
        </div>
        <div className="flex items-center gap-2 border-t border-line-soft bg-sunken px-5 py-3">{footer}</div>
      </div>
    );

  return (
    <div className="flex flex-col">
      {body}
      {error && <div className="mt-4">{error}</div>}
      <div className="mt-5 flex items-center gap-2">{footer}</div>
    </div>
  );
}

/** Method, details, done: where you are in adding a mailbox. */
function Stepper({ step }: { step: 0 | 1 | 2 }) {
  const { t } = useTranslation("settingsChannels");
  const labels = [t("wizard.stepMethod"), t("wizard.stepDetails"), t("wizard.stepDone")];
  return (
    <ol className="flex items-center gap-2 border-b border-line-soft px-5 py-3" aria-label={t("new.title")}>
      {labels.map((l, i) => {
        const done = i < step;
        const cur = i === step;
        return (
          <li key={l} className="flex items-center gap-2" aria-current={cur ? "step" : undefined}>
            {i > 0 && <span aria-hidden className={cn("h-px w-6 transition-colors duration-200", done || cur ? "bg-fg-3" : "bg-line")} />}
            <span
              className={cn(
                "mono flex size-[18px] items-center justify-center rounded-sm text-[10.5px] transition-colors duration-200",
                done ? "bg-inverse text-inverse-fg" : cur ? "border border-fg-2 text-fg" : "border border-line text-fg-4",
              )}
            >
              {done ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("text-[12.5px]", cur ? "font-medium text-fg" : done ? "text-fg-2" : "text-fg-4")}>{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DetailsStep({
  method,
  form,
  set,
  errors,
  compact,
  teams,
}: {
  method: Method;
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  errors: Errors;
  compact?: boolean;
  teams: { id: string; name: string }[];
}) {
  const { t } = useTranslation("settingsChannels");
  const grid = cn("grid gap-3", !compact && "sm:grid-cols-2");
  const oauthKind = method === "google" || method === "microsoft";
  return (
    <div className="flex flex-col gap-5">
      <div className={grid}>
        <Field label={t("wizard.name")} hint={t("wizard.nameHint")} error={errors.name}>
          {({ id, invalid }) => <TextInput id={id} autoFocus invalid={invalid} value={form.name} placeholder={t("wizard.namePlaceholder")} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label={t("wizard.email")} optional={oauthKind} hint={oauthKind ? t("wizard.emailOauthHint") : undefined} error={errors.email}>
          {({ id, invalid }) => (
            <TextInput id={id} type="email" className="mono" invalid={invalid} value={form.email} placeholder="support@company.com" onChange={(e) => set("email", e.target.value)} />
          )}
        </Field>
        {!oauthKind && (
          <>
            <Field label={t("wizard.senderName")} optional hint={t("wizard.senderNameHint")}>
              {({ id }) => <TextInput id={id} value={form.display_name} placeholder={t("wizard.senderPlaceholder")} onChange={(e) => set("display_name", e.target.value)} />}
            </Field>
            <Field label={t("wizard.team")} optional hint={t("wizard.teamHint")}>
              {({ id }) => (
                <Select
                  id={id}
                  value={form.team_id || "__none"}
                  onChange={(v) => set("team_id", v === "__none" ? "" : v)}
                  options={[{ value: "__none", label: t("wizard.noTeam") }, ...teams.map((x) => ({ value: x.id, label: x.name }))]}
                />
              )}
            </Field>
          </>
        )}
      </div>

      {oauthKind && (
        <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs leading-[18px] text-fg-3">
          {t("wizard.oauthNote", { provider: method === "google" ? "Google" : "Microsoft" })}
        </p>
      )}

      {method === "forwarding" && (
        <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs leading-[18px] text-fg-3">{t("wizard.forwardingNote")}</p>
      )}

      {method === "imap" && (
        <>
          <ServerFields
            title={t("wizard.incoming")}
            host={form.imap_host}
            port={form.imap_port}
            tls={form.imap_tls}
            username={form.imap_username}
            password={form.imap_password}
            onHost={(v) => set("imap_host", v)}
            onPort={(v) => set("imap_port", v)}
            onTls={(v) => {
              set("imap_tls", v);
              set("imap_port", v === "tls" ? 993 : 143);
            }}
            onUsername={(v) => set("imap_username", v)}
            onPassword={(v) => set("imap_password", v)}
            errors={{ host: errors.imap_host, username: errors.imap_username, password: errors.imap_password }}
            hostPlaceholder="imap.company.com"
            compact={compact}
          />
          <ServerFields
            title={t("wizard.outgoing")}
            host={form.smtp_host}
            port={form.smtp_port}
            tls={form.smtp_tls}
            username={form.smtp_username}
            password={form.smtp_password}
            onHost={(v) => set("smtp_host", v)}
            onPort={(v) => set("smtp_port", v)}
            onTls={(v) => {
              set("smtp_tls", v);
              set("smtp_port", v === "tls" ? 465 : 587);
            }}
            onUsername={(v) => set("smtp_username", v)}
            onPassword={(v) => set("smtp_password", v)}
            errors={{ host: errors.smtp_host, username: errors.smtp_username, password: errors.smtp_password }}
            hostPlaceholder="smtp.company.com"
            hideCredentials={form.smtp_same}
            compact={compact}
            extra={
              <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
                <Checkbox checked={form.smtp_same} onCheckedChange={(v) => set("smtp_same", v)} />
                {t("wizard.sameCredentials")}
              </label>
            }
          />
        </>
      )}
    </div>
  );
}

function ServerFields(p: {
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
  errors: { host?: string; username?: string; password?: string };
  hostPlaceholder: string;
  hideCredentials?: boolean;
  extra?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useTranslation("settingsChannels");
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-sunken/50 p-3.5">
      <legend className="px-1 text-[12.5px] font-medium">{p.title}</legend>
      <div className={cn("grid gap-3", p.compact ? "grid-cols-[1fr_96px]" : "grid-cols-[1fr_110px]")}>
        <Field label={t("wizard.server")} error={p.errors.host}>
          {({ id, invalid }) => <TextInput id={id} className="mono" invalid={invalid} value={p.host} placeholder={p.hostPlaceholder} onChange={(e) => p.onHost(e.target.value)} />}
        </Field>
        <Field label={t("wizard.port")}>
          {({ id }) => <NumberInput id={id} value={p.port} min={1} max={65535} onChange={p.onPort} />}
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium">{t("wizard.security")}</span>
        <Segmented
          value={p.tls}
          onChange={p.onTls}
          options={[
            { value: "tls", label: "TLS" },
            { value: "starttls", label: "STARTTLS" },
            { value: "none", label: t("wizard.tlsNone") },
          ]}
        />
        {p.tls === "none" && <p className="text-xs text-tone-amber">{t("wizard.noTls")}</p>}
      </div>
      {p.extra}
      {!p.hideCredentials && (
        <div className={cn("grid gap-3", !p.compact && "sm:grid-cols-2")}>
          <Field label={t("wizard.username")} error={p.errors.username}>
            {({ id, invalid }) => <TextInput id={id} className="mono" autoComplete="off" invalid={invalid} value={p.username} onChange={(e) => p.onUsername(e.target.value)} />}
          </Field>
          <Field label={t("wizard.password")} hint={t("wizard.passwordHint")} error={p.errors.password}>
            {({ id, invalid }) => <TextInput id={id} type="password" autoComplete="new-password" invalid={invalid} value={p.password} onChange={(e) => p.onPassword(e.target.value)} />}
          </Field>
        </div>
      )}
    </fieldset>
  );
}

function DoneStep({ mailbox, method, test }: { mailbox: Mailbox; method: Method; test: MailboxTest | null }) {
  const { t } = useTranslation("settingsChannels");
  if (method === "forwarding") return <ForwardingInstructions mailbox={mailbox} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={cn("flex size-8 items-center justify-center rounded-md animate-indicator-in motion-reduce:animate-none", tone.green.chip)}>
          <Check className="size-4" strokeWidth={2.5} />
        </span>
        <div>
          <div className="text-[13.5px] font-medium">{t("wizard.connected", { name: mailbox.name })}</div>
          <div className="mono text-xs text-fg-3">{mailbox.email}</div>
        </div>
      </div>
      {test ? <TestResults result={test} /> : <p className="text-xs text-fg-3">{t("wizard.testRunning")}</p>}
      {test && (!test.inbound.ok || !test.outbound.ok) && <p className="text-xs text-fg-3">{t("wizard.fixLater")}</p>}
    </div>
  );
}

type Provider = "gmail" | "workspace" | "microsoft";
const STEPS = ["s1", "s2", "s3", "s4"] as const;

export function ForwardingInstructions({ mailbox }: { mailbox: Mailbox }) {
  const { t } = useTranslation("settingsChannels");
  const [p, setP] = useState<Provider>("gmail");
  const code = <span className="mono" />;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-[12.5px] font-medium">
          <Trans t={t} i18nKey="forwarding.forwardTo" values={{ email: mailbox.email }} components={{ code }} />
        </div>
        <CopyField value={mailbox.forwarding_address} />
      </div>
      <div className="flex flex-col gap-3">
        <Segmented
          size="xs"
          className="self-start"
          value={p}
          onChange={setP}
          options={[
            { value: "gmail", label: t("forwarding.gmail") },
            { value: "workspace", label: t("forwarding.workspace") },
            { value: "microsoft", label: t("forwarding.microsoft") },
          ]}
        />
        <ol key={p} className="flex flex-col gap-2.5">
          {STEPS.map((k, i) => (
            <li
              key={k}
              className="flex animate-rise-in gap-2.5 text-[12.5px] leading-5 text-fg-2 motion-reduce:animate-none [&_b]:font-medium [&_b]:text-fg"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <span className="mono flex size-5 shrink-0 items-center justify-center rounded-sm border border-line bg-sunken text-[10.5px] text-fg-3">{i + 1}</span>
              <span>
                <Trans t={t} i18nKey={`forwarding.steps.${p}.${k}`} components={{ b: <b /> }} />
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs leading-[18px] text-fg-3">
        <Trans t={t} i18nKey="forwarding.checkIt" values={{ email: mailbox.email }} components={{ code: <span className="mono text-fg-2" /> }} />
      </p>
    </div>
  );
}
