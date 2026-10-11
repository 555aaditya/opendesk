import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronLeft, Forward, Server } from "lucide-react";
import { useState, type ReactNode } from "react";
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
import { GoogleGlyph, MicrosoftGlyph, TestResults } from "./kinds";

export type Method = "google" | "microsoft" | "forwarding" | "imap";

const methods: { id: Method; title: string; body: string; icon: ReactNode; tag?: string }[] = [
  { id: "google", title: "Gmail or Google Workspace", body: "Sign in with Google. Mail syncs and replies send from your address.", icon: <GoogleGlyph className="size-5" />, tag: "Recommended" },
  { id: "microsoft", title: "Microsoft 365 or Outlook", body: "Sign in with Microsoft. Works with Exchange Online mailboxes.", icon: <MicrosoftGlyph className="size-5" /> },
  { id: "forwarding", title: "Forward from any provider", body: "Forward mail to an address opendesk gives you. No passwords shared.", icon: <Forward className="size-5" /> },
  { id: "imap", title: "IMAP and SMTP", body: "Connect any mail server with a username and password.", icon: <Server className="size-5" /> },
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

function validate(method: Method, f: Form): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = "Give the mailbox a name, like Support.";
  if ((method === "forwarding" || method === "imap") && !emailRe.test(f.email.trim())) e.email = "Enter the address customers write to.";
  if ((method === "google" || method === "microsoft") && f.email.trim() && !emailRe.test(f.email.trim())) e.email = "That doesn't look like an email address.";
  if (method === "imap") {
    if (!hostRe.test(f.imap_host.trim())) e.imap_host = "Enter a server name, like imap.example.com.";
    if (!f.imap_username.trim()) e.imap_username = "Usually your full email address.";
    if (!f.imap_password) e.imap_password = "Enter the password or an app password.";
    if (!hostRe.test(f.smtp_host.trim())) e.smtp_host = "Enter a server name, like smtp.example.com.";
    if (!f.smtp_same) {
      if (!f.smtp_username.trim()) e.smtp_username = "Enter the SMTP username.";
      if (!f.smtp_password) e.smtp_password = "Enter the SMTP password.";
    }
  }
  return e;
}

const slide = {
  enter: (dir: number) => ({ x: dir * 28, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -28, opacity: 0 }),
};

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
      if (!method) return setBlocked("Choose how this mailbox connects.");
      return go(1);
    }
    if (step === 1 && method) {
      const e = validate(method, form);
      setErrors(e);
      if (Object.keys(e).length) return setBlocked("Fix the highlighted fields to continue.");
      setBlocked(null);
      if (method === "google" || method === "microsoft") oauth.mutate(method);
      else create.mutate();
    }
  };

  const cancel = () => {
    if (!onCancel) return;
    if (!dirty) return onCancel();
    confirm.show("The details you entered will be lost.", onCancel, { title: "Discard this mailbox?", confirmLabel: "Discard", danger: true });
  };

  const busy = oauth.isPending || create.isPending;
  const primaryLabel =
    step === 0 ? "Continue" : method === "google" ? "Continue with Google" : method === "microsoft" ? "Continue with Microsoft" : method === "imap" ? "Connect and test" : "Create mailbox";

  return (
    <div className="flex flex-col">
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {step === 0 && (
              <div role="radiogroup" aria-label="Connection method" className={cn("grid gap-2", !compact && "sm:grid-cols-2")}>
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={method === m.id}
                    onClick={() => {
                      setMethod(m.id);
                      setBlocked(null);
                    }}
                    onDoubleClick={() => {
                      setMethod(m.id);
                      go(1);
                    }}
                    className={cn(
                      "group relative flex items-start gap-3 rounded-lg border bg-surface p-3.5 text-left transition-[border-color,box-shadow] duration-100",
                      method === m.id ? "border-fg-2 shadow-[0_0_0_1px_var(--fg-2)]" : "border-line hover:border-line-strong",
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-canvas text-fg">{m.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium">
                        {m.title}
                        {m.tag && <span className="rounded-sm bg-hover px-1.5 py-px text-[10.5px] font-medium text-fg-3">{m.tag}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs leading-[18px] text-fg-3">{m.body}</span>
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                        method === m.id ? "border-inverse bg-inverse text-inverse-fg" : "border-line-strong",
                      )}
                    >
                      {method === m.id && <Check className="size-2.5" strokeWidth={3.5} />}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {step === 1 && method && (
              <DetailsStep method={method} form={form} set={set} errors={errors} compact={compact} teams={teams ?? []} />
            )}

            {step === 2 && created && (
              <DoneStep mailbox={created} method={method!} test={test} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {blocked && <p className="mt-4 text-xs text-danger-fg" role="alert">{blocked}</p>}

      <div className="mt-5 flex items-center gap-2">
        {step === 1 && (
          <Button variant="ghost" icon={<ChevronLeft className="size-3.5" />} onClick={() => go(0)} disabled={busy}>
            Back
          </Button>
        )}
        {step < 2 && onCancel && (
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
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
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
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
  const grid = cn("grid gap-3", !compact && "sm:grid-cols-2");
  const oauthKind = method === "google" || method === "microsoft";
  return (
    <div className="flex flex-col gap-5">
      <div className={grid}>
        <Field label="Name" hint="Shown to your team, like Support or Billing." error={errors.name}>
          {({ id, invalid }) => <TextInput id={id} autoFocus invalid={invalid} value={form.name} placeholder="Support" onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="Email address" optional={oauthKind} hint={oauthKind ? "The account you'll sign in with." : undefined} error={errors.email}>
          {({ id, invalid }) => (
            <TextInput id={id} type="email" className="mono" invalid={invalid} value={form.email} placeholder="support@company.com" onChange={(e) => set("email", e.target.value)} />
          )}
        </Field>
        {!oauthKind && (
          <>
            <Field label="Sender name" optional hint="Customers see this in their inbox.">
              {({ id }) => <TextInput id={id} value={form.display_name} placeholder="Company Support" onChange={(e) => set("display_name", e.target.value)} />}
            </Field>
            <Field label="Team" optional hint="New tickets go to this team.">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.team_id || "__none"}
                  onChange={(v) => set("team_id", v === "__none" ? "" : v)}
                  options={[{ value: "__none", label: "No team" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                />
              )}
            </Field>
          </>
        )}
      </div>

      {oauthKind && (
        <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs leading-[18px] text-fg-3">
          You'll go to {method === "google" ? "Google" : "Microsoft"} to approve access, then come back here. opendesk reads and sends mail for
          this address only, and you can disconnect at any time.
        </p>
      )}

      {method === "forwarding" && (
        <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs leading-[18px] text-fg-3">
          After you create it, you get a private address to forward mail to. Replies are sent from opendesk's own sending address on behalf of
          your address, until you add SMTP in the mailbox settings.
        </p>
      )}

      {method === "imap" && (
        <>
          <ServerFields
            title="Incoming mail (IMAP)"
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
            title="Outgoing mail (SMTP)"
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
                Use the same username and password as IMAP
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
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-3.5">
      <legend className="px-1 text-[12.5px] font-medium">{p.title}</legend>
      <div className={cn("grid gap-3", p.compact ? "grid-cols-[1fr_96px]" : "grid-cols-[1fr_110px]")}>
        <Field label="Server" error={p.errors.host}>
          {({ id, invalid }) => <TextInput id={id} className="mono" invalid={invalid} value={p.host} placeholder={p.hostPlaceholder} onChange={(e) => p.onHost(e.target.value)} />}
        </Field>
        <Field label="Port">
          {({ id }) => <NumberInput id={id} value={p.port} min={1} max={65535} onChange={p.onPort} />}
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium">Security</span>
        <Segmented
          value={p.tls}
          onChange={p.onTls}
          options={[
            { value: "tls", label: "TLS" },
            { value: "starttls", label: "STARTTLS" },
            { value: "none", label: "None" },
          ]}
        />
        {p.tls === "none" && <p className="text-xs text-fg-3">Passwords travel unencrypted. Use this only on a private network.</p>}
      </div>
      {p.extra}
      {!p.hideCredentials && (
        <div className={cn("grid gap-3", !p.compact && "sm:grid-cols-2")}>
          <Field label="Username" error={p.errors.username}>
            {({ id, invalid }) => <TextInput id={id} className="mono" autoComplete="off" invalid={invalid} value={p.username} onChange={(e) => p.onUsername(e.target.value)} />}
          </Field>
          <Field label="Password" hint="An app password if your provider requires one." error={p.errors.password}>
            {({ id, invalid }) => <TextInput id={id} type="password" autoComplete="new-password" invalid={invalid} value={p.password} onChange={(e) => p.onPassword(e.target.value)} />}
          </Field>
        </div>
      )}
    </fieldset>
  );
}

function DoneStep({ mailbox, method, test }: { mailbox: Mailbox; method: Method; test: MailboxTest | null }) {
  if (method === "forwarding") return <ForwardingInstructions mailbox={mailbox} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-full bg-inverse text-inverse-fg">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
        <div>
          <div className="text-[13.5px] font-medium">{mailbox.name} is connected</div>
          <div className="mono text-xs text-fg-3">{mailbox.email}</div>
        </div>
      </div>
      {test ? <TestResults result={test} /> : <p className="text-xs text-fg-3">The connection test is still running. Check the mailbox status in a minute.</p>}
      {test && (!test.inbound.ok || !test.outbound.ok) && (
        <p className="text-xs text-fg-3">You can fix the server settings on the mailbox page and test again.</p>
      )}
    </div>
  );
}

type Provider = "gmail" | "workspace" | "microsoft";

const steps: Record<Provider, ReactNode[]> = {
  gmail: [
    <>In Gmail, open <b>Settings</b>, then <b>See all settings</b>, then <b>Forwarding and POP/IMAP</b>.</>,
    <>Choose <b>Add a forwarding address</b> and paste the address above.</>,
    <>Gmail sends a confirmation email. It arrives in opendesk as a ticket: open it and click the link, or copy the code into Gmail.</>,
    <>Back in Gmail, select <b>Forward a copy of incoming mail to</b> the new address and save.</>,
  ],
  workspace: [
    <>For one mailbox, follow the Gmail steps while signed in as that user.</>,
    <>For a group or many users, open the Google Admin console, then <b>Apps</b>, <b>Google Workspace</b>, <b>Gmail</b>, <b>Routing</b>.</>,
    <>Add a routing rule for the address, choose <b>Also deliver to</b> and add the address above as a recipient.</>,
    <>Save. Changes can take a few minutes to apply.</>,
  ],
  microsoft: [
    <>Open the Exchange admin center, then <b>Recipients</b>, <b>Mailboxes</b>, and select the mailbox.</>,
    <>Under <b>Mail flow settings</b>, choose <b>Manage email forwarding</b>.</>,
    <>Turn on forwarding, paste the address above, and keep <b>Deliver to both</b> on if the mailbox should still get a copy.</>,
    <>If outbound forwarding is blocked, allow it in the outbound spam policy, or use an Outlook rule that forwards to the address instead.</>,
  ],
};

export function ForwardingInstructions({ mailbox }: { mailbox: Mailbox }) {
  const [p, setP] = useState<Provider>("gmail");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-1.5 text-[12.5px] font-medium">Forward mail for <span className="mono">{mailbox.email}</span> to</div>
        <CopyField value={mailbox.forwarding_address} />
      </div>
      <div className="flex flex-col gap-3">
        <Segmented
          size="xs"
          className="self-start"
          value={p}
          onChange={setP}
          options={[
            { value: "gmail", label: "Gmail" },
            { value: "workspace", label: "Google Workspace" },
            { value: "microsoft", label: "Microsoft 365" },
          ]}
        />
        <ol className="flex flex-col gap-2.5">
          {steps[p].map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[12.5px] leading-5 text-fg-2 [&_b]:font-medium [&_b]:text-fg">
              <span className="mono flex size-5 shrink-0 items-center justify-center rounded-full border border-line text-[10.5px] text-fg-3">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs leading-[18px] text-fg-3">
        To check it works, send an email to <span className="mono text-fg-2">{mailbox.email}</span> from another account. It shows up as a new ticket in Unassigned.
      </p>
    </div>
  );
}
