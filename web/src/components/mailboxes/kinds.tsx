import { Forward, Server } from "lucide-react";
import type { Mailbox, MailboxTest } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Dot } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

export function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden fill="none">
      <path
        d="M20.6 12.2c0-.6-.1-1.2-.2-1.8H12v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z"
        fill="currentColor"
      />
      <path
        d="M12 21c2.4 0 4.5-.8 5.9-2.2L15 16.6c-.8.5-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21Z"
        fill="currentColor"
        opacity=".75"
      />
      <path d="M7 13.8a5.4 5.4 0 0 1 0-3.5V8H4a9 9 0 0 0 0 8.1l3-2.3Z" fill="currentColor" opacity=".5" />
      <path d="M12 6.6c1.3 0 2.5.5 3.4 1.3L18 5.4A9 9 0 0 0 4 8l3 2.3c.7-2.1 2.7-3.7 5-3.7Z" fill="currentColor" opacity=".9" />
    </svg>
  );
}

export function MicrosoftGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} aria-hidden>
      <rect x="3" y="3" width="8.5" height="8.5" fill="currentColor" />
      <rect x="12.5" y="3" width="8.5" height="8.5" fill="currentColor" opacity=".7" />
      <rect x="3" y="12.5" width="8.5" height="8.5" fill="currentColor" opacity=".55" />
      <rect x="12.5" y="12.5" width="8.5" height="8.5" fill="currentColor" opacity=".85" />
    </svg>
  );
}

export const kindLabel: Record<Mailbox["inbound_kind"], string> = {
  google: "Google",
  microsoft: "Microsoft 365",
  imap: "IMAP and SMTP",
  forwarding: "Forwarding",
};

export function MailboxGlyph({ kind, className }: { kind: Mailbox["inbound_kind"]; className?: string }) {
  if (kind === "google") return <GoogleGlyph className={className} />;
  if (kind === "microsoft") return <MicrosoftGlyph className={className} />;
  if (kind === "imap") return <Server className={cn("size-4", className)} aria-hidden />;
  return <Forward className={cn("size-4", className)} aria-hidden />;
}

export function MailboxIcon({ kind }: { kind: Mailbox["inbound_kind"] }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-fg-2">
      <MailboxGlyph kind={kind} />
    </span>
  );
}

export function MailboxStatus({ mailbox }: { mailbox: Pick<Mailbox, "status" | "last_error"> }) {
  const label = { active: "Active", error: "Needs attention", disabled: "Disabled" }[mailbox.status];
  const tone = { active: "ok", error: "danger", disabled: "muted" } as const;
  const el = (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-2">
      <Dot tone={tone[mailbox.status]} />
      {label}
    </span>
  );
  return mailbox.status === "error" && mailbox.last_error ? <Tooltip content={mailbox.last_error}>{el}</Tooltip> : el;
}

export function TestResults({ result }: { result: MailboxTest }) {
  const line = (label: string, r: { ok: boolean; error: string }) => (
    <div className="flex items-start gap-2.5 py-1.5">
      <Dot tone={r.ok ? "ok" : "danger"} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium">
          {label} {r.ok ? "works" : "failed"}
        </div>
        {!r.ok && r.error && <div className="mono mt-0.5 break-words text-xs text-fg-3">{r.error}</div>}
      </div>
    </div>
  );
  return (
    <div className="rounded-md border border-line bg-sunken px-3 py-1">
      {line("Receiving", result.inbound)}
      {line("Sending", result.outbound)}
    </div>
  );
}
