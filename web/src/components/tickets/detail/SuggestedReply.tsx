// Ollie's suggested reply on an email ticket (contracts/agent.md "Email", draft
// mode): shown above the composer with Send (as written, attributed to Ollie),
// Edit (into the composer, sent as your own reply) and Discard. Arrives live
// through ai_suggested_reply events (lib/realtime/apply.ts).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, PenLine, Send, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Message, SuggestedReply, Ticket } from "@/lib/api/types";
import { api } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import { q, qk } from "@/lib/queries";
import { sanitizeHtml } from "@/lib/sanitize";
import { AI_TONE, tone } from "@/lib/tones";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { OllieAvatar, useAssistantName } from "../ollie";

export function SuggestedReplyCard({ ticket, hasDraft, onEdit }: { ticket: Ticket; hasDraft: boolean; onEdit: (html: string) => void }) {
  const { t } = useTranslation("aiTicket");
  const name = useAssistantName();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const confirm = useConfirm();
  const key = qk.suggestedReply(ticket.id);
  const { data } = useQuery({ ...q.suggestedReply(ticket.id), enabled: ticket.channel === "email" });
  // Edit hides the card while the text is in the composer; sending it there clears it for good.
  const [editing, setEditing] = useState<string | null>(null);

  const clearIf = (id: string) => qc.setQueryData<SuggestedReply | null>(key, (old) => (old?.id === id ? null : old));
  const send = useMutation({
    mutationFn: (s: SuggestedReply) => api.ai.suggestedReply.send(ticket.id, s.id),
    onSuccess: (m, s) => {
      clearIf(s.id);
      qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
      toast.success(t("suggested.sent"));
    },
    onError: (e, s) => {
      if (isApiError(e, "suggestion_not_pending")) {
        clearIf(s.id);
        toast.error(t("suggested.gone"));
      } else toast.error(e, t("suggested.sendFailed"));
    },
  });
  const discard = useMutation({
    mutationFn: (s: SuggestedReply) => api.ai.suggestedReply.discard(ticket.id, s.id),
    onMutate: (s) => {
      clearIf(s.id);
      return { s };
    },
    onError: (e, _s, ctx) => {
      if (ctx?.s) qc.setQueryData(key, ctx.s);
      toast.error(e, t("suggested.discardFailed"));
    },
  });

  const s = data && data.status === "pending" && data.id !== editing ? data : null;
  const edit = (r: SuggestedReply) => {
    const go = () => {
      setEditing(r.id);
      onEdit(r.body_html);
    };
    if (hasDraft) confirm.show(t("suggested.replaceBody", { name }), go, { title: t("suggested.replaceTitle"), confirmLabel: t("suggested.replaceConfirm") });
    else go();
  };
  const links = s?.sources.filter((x) => x.url) ?? [];

  return (
    <AnimatePresence initial={false}>
      {s && (
        <motion.section
          key={s.id}
          aria-label={t("suggested.label", { name })}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
          className={cn("mb-2 overflow-hidden rounded-lg border bg-surface shadow-xs", tone[AI_TONE].line)}
        >
          <header className={cn("flex items-center gap-2 border-b px-3 py-2", tone[AI_TONE].soft, tone[AI_TONE].line)}>
            <OllieAvatar size={16} />
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px] font-medium", tone[AI_TONE].text)}>{t("suggested.title", { name })}</span>
            <span className="hidden shrink-0 text-[11.5px] text-fg-3 sm:inline">{t("suggested.hint")}</span>
          </header>
          <div className="max-h-56 overflow-y-auto px-3 py-2.5">
            <div className="prose-od ph-no-capture text-[13px]" data-ph-mask dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.body_html) }} />
          </div>
          {links.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft px-3 py-1.5 text-[11.5px] text-fg-3">
              <span className="shrink-0">{t("suggested.basedOn")}</span>
              {links.slice(0, 4).map((l) => (
                <a
                  key={`${l.kind}-${l.id}`}
                  href={l.url!}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-5 max-w-[220px] items-center gap-1 rounded-sm bg-hover px-1.5 text-fg-2 hover:text-fg"
                >
                  <span className="truncate">{l.title}</span>
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
              ))}
            </div>
          )}
          <footer className="flex items-center gap-1.5 border-t border-line-soft bg-sunken px-2 py-1.5">
            <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} loading={send.isPending} disabled={discard.isPending} onClick={() => send.mutate(s)}>
              {t("suggested.send")}
            </Button>
            <Button size="sm" icon={<PenLine className="size-3.5" />} disabled={send.isPending} onClick={() => edit(s)}>
              {t("suggested.edit")}
            </Button>
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} disabled={send.isPending} onClick={() => discard.mutate(s)} className="ml-auto">
              {t("suggested.discard")}
            </Button>
          </footer>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
