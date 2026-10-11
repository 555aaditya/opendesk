// "Draft article from tickets" (contracts/ai.md, POST /v1/kb/articles/ai/draft,
// 5 credits). Pick conversations and/or describe a topic; the draft is handed
// back to the editor, never saved here.

import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label, TextInput } from "@/components/ui/input";
import { Picker } from "@/components/ui/picker";
import { StatusIcon } from "@/components/tickets/bits";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isPlanLimit } from "@/lib/api/client";
import type { KBArticleDraft, Ticket } from "@/lib/api/types";
import { AiIcon, useCreditLabel } from "./bits";

/** The server drafts from at most 10 tickets. */
const MAX_TICKETS = 10;

export function KbDraftDialog({
  open,
  onOpenChange,
  onDraft,
  initialTickets = [],
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDraft: (d: KBArticleDraft) => void;
  initialTickets?: Ticket[];
}) {
  const { t } = useTranslation("ai");
  const { t: tc } = useTranslation();
  const credits = useCreditLabel()("kb_draft");
  const [picked, setPicked] = useState<Ticket[]>(initialTickets);
  const [topic, setTopic] = useState("");
  const [query, setQuery] = useState("");
  const [tried, setTried] = useState(false);

  const search = useQuery({
    queryKey: ["ai", "kb-draft-tickets", query],
    queryFn: () => api.tickets.list({ q: query.trim() || undefined, limit: 8, spam: false }),
    enabled: open,
    staleTime: 30_000,
  });
  const results = search.data?.data ?? [];
  const known = new Map([...picked, ...results].map((x) => [x.id, x]));

  const draft = useMutation({
    mutationFn: () => api.ai.kbDraft({ ticket_ids: picked.length ? picked.map((x) => x.id) : undefined, topic: topic.trim() || undefined }),
    onSuccess: (d) => {
      onDraft(d);
      onOpenChange(false);
      setPicked([]);
      setTopic("");
      setTried(false);
    },
  });

  const empty = !picked.length && !topic.trim();
  const submit = () => {
    setTried(true);
    if (empty || draft.isPending) return;
    draft.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !draft.isPending && onOpenChange(o)}
      title={
        <span className="flex items-center gap-2">
          <AiIcon className="text-fg-3" />
          {t("kb_draft.title")}
        </span>
      }
      description={t("kb_draft.description")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={draft.isPending}>
            {tc("actions.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} loading={draft.isPending} icon={<AiIcon />}>
            {draft.isPending ? t("kb_draft.generating") : t("kb_draft.generate")}
            {credits && !draft.isPending && <span className="mono ml-1 text-[10.5px] opacity-60">{credits}</span>}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label>{t("kb_draft.tickets")}</Label>
          <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-line px-1.5 py-1.5">
            {picked.map((x) => (
              <span key={x.id} className="inline-flex h-6 max-w-[260px] items-center gap-1.5 rounded-[5px] border border-line bg-sunken pl-1.5 pr-0.5 text-[12px]">
                <span className="mono text-[11px] text-fg-3">#{x.number}</span>
                <span className="truncate text-fg-2">{x.subject}</span>
                <button
                  type="button"
                  aria-label={t("kb_draft.remove_ticket", { subject: x.subject })}
                  onClick={() => setPicked((p) => p.filter((y) => y.id !== x.id))}
                  className="flex size-5 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-fg"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <Picker
              multi
              values={picked.map((x) => x.id)}
              onChange={(ids) => setPicked(ids.map((id) => known.get(id)).filter((x): x is Ticket => !!x).slice(0, MAX_TICKETS))}
              onQueryChange={setQuery}
              placeholder={t("kb_draft.tickets_placeholder")}
              emptyText={search.isFetching ? "…" : t("kb_draft.tickets_empty")}
              width={380}
              items={results.map((x) => ({
                value: x.id,
                label: x.subject,
                icon: <StatusIcon status={x.status} />,
                hint: <span className="mono">#{x.number}</span>,
              }))}
              trigger={
                <button type="button" className="inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[12px] text-fg-3 hover:bg-hover hover:text-fg">
                  <Plus className="size-3" />
                  {t("kb_draft.add_ticket")}
                </button>
              }
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kb-draft-topic">{t("kb_draft.topic")}</Label>
          <TextInput id="kb-draft-topic" value={topic} maxLength={200} placeholder={t("kb_draft.topic_placeholder")} onChange={(e) => setTopic(e.target.value)} />
        </div>
        {draft.isPending && (
          <div aria-live="polite" className="flex flex-col gap-2 rounded-md border border-line-soft px-3 py-3">
            <span className="skeleton h-2.5 w-2/3" />
            <span className="skeleton h-2.5 w-full" />
            <span className="skeleton h-2.5 w-5/6" />
          </div>
        )}
        {tried && empty && <p className="text-[12.5px] text-danger-fg">{t("kb_draft.need_input")}</p>}
        {draft.error && !isPlanLimit(draft.error) && <p className="text-[12.5px] text-danger-fg">{errorMessage(draft.error)}</p>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
