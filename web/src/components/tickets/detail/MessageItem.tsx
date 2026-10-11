import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, Download, FileText, Lock, MoreHorizontal, RotateCw } from "lucide-react";
import { memo, useState } from "react";
import type { Attachment, Message } from "@/lib/api/types";
import { api } from "@/lib/api/endpoints";
import { sanitizeHtml } from "@/lib/sanitize";
import { bytes, clock, fullDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { AiAuthorLabel, TranslateButton, TranslatedNote, useMessageTranslation } from "@/components/ai/ticket/MessageAi";

function authorName(m: Message): string {
  if (m.author.user) return m.author.user.name;
  if (m.author.contact) return m.author.contact.name || m.author.contact.email || m.from_email;
  if (m.author.type === "system") return "opendesk";
  if (m.author.type === "api") return m.from_name || "API";
  return m.from_name || m.from_email || "Unknown";
}

function Body({ html, className }: { html: string; className?: string }) {
  return <div className={cn("prose-od ph-no-capture", className)} data-ph-mask dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
}

function Original({ id }: { id: string }) {
  const { data, isPending, isError } = useQuery({ queryKey: ["message-original", id], queryFn: () => api.messages.original(id), staleTime: Infinity });
  if (isPending)
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-fg-3">
        <Spinner className="size-3" /> Loading the original
      </div>
    );
  if (isError) return <p className="mt-3 text-xs text-fg-3">The original message isn't available.</p>;
  return <Body html={data.full_html} className="mt-3 border-l-2 border-line pl-3 text-[13px] text-fg-2" />;
}

function isImage(a: Attachment) {
  return a.content_type.startsWith("image/");
}

export function Attachments({ items }: { items: Attachment[] }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const visible = items.filter((a) => !a.inline);
  if (!visible.length) return null;
  const images = visible.filter(isImage);
  const files = visible.filter((a) => !isImage(a));
  return (
    <div className="mt-3 flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setPreview(a)}
              className="group relative h-[88px] w-[124px] overflow-hidden rounded-md border border-line bg-sunken"
              aria-label={`Preview ${a.filename}`}
            >
              <img src={a.url} alt="" loading="lazy" className="ph-no-capture size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4 text-left text-[10.5px] text-white">
                {a.filename}
              </span>
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-10 max-w-[260px] items-center gap-2.5 rounded-md border border-line bg-surface pl-2.5 pr-3 hover:border-line-strong"
            >
              <FileText className="size-4 shrink-0 text-fg-3" />
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-fg">{a.filename}</span>
                <span className="mono block text-[10.5px] text-fg-4">{bytes(a.size_bytes)}</span>
              </span>
              <Download className="ml-1 size-3.5 shrink-0 text-fg-4 group-hover:text-fg" />
            </a>
          ))}
        </div>
      )}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)} title={preview?.filename ?? ""} size="xl">
        {preview && (
          <div className="flex flex-col items-center gap-3 pb-2">
            <img src={preview.url} alt={preview.filename} className="ph-no-capture max-h-[60vh] max-w-full rounded-md border border-line" />
            <a href={preview.url} target="_blank" rel="noopener noreferrer" className="text-xs text-fg-3 underline underline-offset-2 hover:text-fg">
              Open full size
            </a>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Delivery({ m, onRetry }: { m: Message; onRetry?: () => void }) {
  if (m.kind === "note" || m.direction === "inbound" || m.delivery_status === "none") return null;
  if (m.delivery_status === "pending")
    return (
      <span className="flex items-center gap-1 text-[11px] text-fg-4">
        <Spinner className="size-3" /> Sending
      </span>
    );
  if (m.delivery_status === "sent")
    return (
      <Tooltip content={`Delivered to ${m.to.join(", ") || "the customer"}`}>
        <span className="flex items-center gap-1 text-[11px] text-fg-4">
          <Check className="size-3" /> Sent
        </span>
      </Tooltip>
    );
  return (
    <span className="flex items-center gap-2">
      <Tooltip content={m.delivery_error || "The mail server refused this message"}>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-danger-fg">
          <span className="size-1.5 rounded-full bg-danger" />
          {m.delivery_status === "bounced" ? "Bounced" : "Not delivered"}
        </span>
      </Tooltip>
      {onRetry && (
        <Button size="xs" variant="secondary" icon={<RotateCw className="size-3" />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </span>
  );
}

export const MessageItem = memo(function MessageItem({ m, onRetry, highlight }: { m: Message; onRetry?: (m: Message) => void; highlight?: boolean }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const name = authorName(m);
  const note = m.kind === "note";
  const outbound = m.direction === "outbound" && !note;
  const failed = m.delivery_status === "failed" || m.delivery_status === "bounced";
  const avatar = m.author.user?.avatar_url ?? m.author.contact?.avatar_url;
  const tr = useMessageTranslation(m);

  return (
    <article
      id={`m-${m.id}`}
      aria-label={`${note ? "Note" : "Message"} from ${name}`}
      className={cn(
        "group/msg relative rounded-lg border transition-shadow duration-300",
        note
          ? "border-dashed border-note-line bg-note"
          : failed
            ? "border-[color-mix(in_srgb,var(--danger)_30%,var(--line))] bg-surface"
            : "border-line bg-surface",
        highlight && "shadow-[0_0_0_3px_var(--focus)]",
      )}
    >
      <header className="flex items-center gap-2.5 px-4 pt-3">
        <Avatar name={name} src={avatar} size="md" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate text-[13px] font-medium" data-ph-mask={m.author.contact ? true : undefined}>
            {name}
          </span>
          <AiAuthorLabel m={m} />
          {note ? (
            <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-fg-3">
              <Lock className="size-3" /> Internal note
            </span>
          ) : outbound ? (
            <span className="min-w-0 truncate text-[11.5px] text-fg-3" data-ph-mask>
              to {m.to.join(", ") || "customer"}
              {m.cc.length > 0 && `, cc ${m.cc.join(", ")}`}
            </span>
          ) : (
            <span className="min-w-0 truncate text-[11.5px] text-fg-3" data-ph-mask>
              {m.from_email}
            </span>
          )}
        </div>
        <TranslateButton tr={tr} />
        <Delivery m={m} onRetry={onRetry ? () => onRetry(m) : undefined} />
        <Tooltip content={fullDate(m.created_at)}>
          <time dateTime={m.created_at} className="mono shrink-0 text-[11px] text-fg-4">
            {clock(m.created_at)}
          </time>
        </Tooltip>
      </header>
      <div className="px-4 pb-3.5 pl-[50px] pt-1">
        <TranslatedNote tr={tr} />
        <Body html={tr.showing && tr.html ? tr.html : m.body_html || `<p>${m.body_text}</p>`} />
        {m.has_quoted && (
          <div>
            <Tooltip content={showOriginal ? "Hide quoted text" : "Show original"}>
              <button
                type="button"
                aria-expanded={showOriginal}
                onClick={() => setShowOriginal((v) => !v)}
                className="mt-2 inline-flex h-4 items-center rounded-full bg-hover px-1.5 text-fg-3 hover:bg-active hover:text-fg"
                aria-label={showOriginal ? "Hide quoted text" : "Show original"}
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </Tooltip>
            {showOriginal && <Original id={m.id} />}
          </div>
        )}
        <Attachments items={m.attachments} />
        {failed && m.delivery_error && (
          <p className="mt-3 flex items-start gap-1.5 rounded-md bg-sunken px-2.5 py-2 text-xs text-fg-2">
            <AlertCircle className="mt-px size-3.5 shrink-0 text-danger-fg" />
            <span className="mono">{m.delivery_error}</span>
          </p>
        )}
      </div>
    </article>
  );
});
