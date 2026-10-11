// AI in the ticket side panel: a summary card, triage suggestions with apply,
// and a copilot box to ask questions about the conversation.

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ArrowUp, BookOpen, Check, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AIAnswer, AISummary, Sentiment, Ticket, Triage } from "@/lib/api/types";
import { api } from "@/lib/api/endpoints";
import { useAI } from "@/lib/ai";
import { useRole, atLeast, useSession } from "@/lib/session";
import { relLong, fullDate } from "@/lib/format";
import { sanitizeHtml } from "@/lib/sanitize";
import { patchTicketEverywhere } from "@/lib/ticketCache";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { TagChip } from "@/components/ui/badge";
import { PriorityIcon, priorityLabel } from "@/components/tickets/bits";
import { useUpdateTicket } from "@/components/tickets/useTicketActions";
import { AiIcon, AiTooltip, useCreditLabel } from "../bits";
import { creditsSpent, isAbort, reportAiError } from "./errors";
import { languageName, streamTextToHtml } from "./text";

/** custom.ai_summary is stored as {text, key_points, sentiment, updated_at, message_count} (contracts/ai.md). */
function readSummary(t: Ticket): AISummary | null {
  const s = t.custom?.ai_summary as (Partial<AISummary> & { text?: string }) | undefined;
  const text = typeof s?.text === "string" ? s.text : typeof s?.summary === "string" ? s.summary : null;
  if (!s || text === null) return null;
  return { summary: text, key_points: Array.isArray(s.key_points) ? s.key_points.filter((x) => typeof x === "string") : [], sentiment: (s.sentiment ?? "neutral") as Sentiment, updated_at: s.updated_at ?? t.updated_at };
}

/** Write a change into every cached copy of the ticket (lists and detail, by id or by number). */
function patchCachedTicket(qc: QueryClient, t: Ticket, me: string) {
  patchTicketEverywhere(qc, t, me);
  qc.setQueriesData<Ticket>({ queryKey: ["tickets", "detail"] }, (old) => (old && old.id === t.id ? t : old));
}

const sentimentDot: Record<Sentiment, string> = {
  positive: "bg-fg-3",
  neutral: "bg-line-strong",
  negative: "bg-fg-2",
  frustrated: "bg-fg",
};

function SentimentLabel({ s }: { s: Sentiment }) {
  const { t } = useTranslation("aiTicket");
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-3">
      <span className={cn("size-1.5 rounded-full", sentimentDot[s])} aria-hidden />
      {t(`sentiment.${s}`)}
    </span>
  );
}

function SectionHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-2 flex h-5 items-center gap-1.5">
      <AiIcon className="size-3 text-fg-4" />
      <h3 className="label-caps flex-1">{title}</h3>
      {children}
    </div>
  );
}

function SummaryCard({ t: ticket }: { t: Ticket }) {
  const { t } = useTranslation("aiTicket");
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id ?? "");
  const credits = useCreditLabel()("summarize");
  const stored = readSummary(ticket);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const res = await api.ai.summary(ticket.id);
      const cur = qc.getQueryData<Ticket>(["tickets", "detail", ticket.id]) ?? ticket;
      patchCachedTicket(qc, { ...cur, custom: { ...cur.custom, ai_summary: { text: res.summary, key_points: res.key_points, sentiment: res.sentiment, updated_at: res.updated_at }, ai_sentiment: res.sentiment } }, me);
      creditsSpent(qc);
    } catch (e) {
      reportAiError(e, t("summary.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-line-soft px-4 py-3.5" aria-busy={busy}>
      <SectionHead title={t("summary.title")}>
        {stored && (
          <AiTooltip feature="summarize" label={t("summary.refresh")}>
            <button
              type="button"
              aria-label={t("summary.refresh")}
              onClick={() => void run()}
              disabled={busy}
              className="flex size-5 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-fg disabled:opacity-40"
            >
              <RotateCw className={cn("size-3", busy && "animate-spin")} />
            </button>
          </AiTooltip>
        )}
      </SectionHead>
      {busy && !stored ? (
        <div className="flex flex-col gap-1.5" aria-label={t("summary.working")}>
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-[86%]" />
          <Skeleton className="h-2.5 w-[64%]" />
        </div>
      ) : stored ? (
        <div className={cn("transition-opacity", busy && "opacity-50")} data-ph-mask>
          <p className="text-[12.5px] leading-[19px] text-fg-2">{stored.summary}</p>
          {stored.key_points.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {stored.key_points.map((k, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-[18px] text-fg-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-4" aria-hidden />
                  <span>{k}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2.5 flex items-center gap-2 text-[11px] text-fg-4">
            <SentimentLabel s={stored.sentiment} />
            <span aria-hidden>·</span>
            <Tooltip content={fullDate(stored.updated_at)}>
              <span>{t("summary.updated", { when: relLong(stored.updated_at) })}</span>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[12px] leading-[17px] text-fg-3">{t("summary.empty")}</p>
          <AiTooltip feature="summarize" label={t("summary.generate")}>
            <Button size="xs" variant="secondary" loading={busy} onClick={() => void run()} aria-label={`${t("summary.generate")}${credits ? `, ${credits}` : ""}`}>
              {t("summary.generate")}
            </Button>
          </AiTooltip>
        </div>
      )}
    </section>
  );
}

type Row = { key: "priority" | "tags"; pending: boolean };

function TriageCard({ t: ticket }: { t: Ticket }) {
  const { t } = useTranslation("aiTicket");
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id ?? "");
  const update = useUpdateTicket();
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<Triage | null>(null);

  // A new ticket gets a fresh suggestion.
  useEffect(() => setResult(null), [ticket.id]);

  const suggest = async () => {
    setBusy(true);
    try {
      setResult(await api.ai.triage(ticket.id, false));
      creditsSpent(qc);
    } catch (e) {
      reportAiError(e, t("triage.failed"));
    } finally {
      setBusy(false);
    }
  };

  const current = new Set(ticket.tags.map((x) => x.name.toLowerCase()));
  const newTags = result ? result.tags.filter((x) => !current.has(x.toLowerCase())) : [];
  const rows: Row[] = result
    ? [
        { key: "priority", pending: result.priority !== ticket.priority },
        { key: "tags", pending: newTags.length > 0 || (result.suggested_tags?.length ?? 0) > 0 },
      ]
    : [];
  const anyPending = rows.some((r) => r.pending);

  const applyRow = (key: Row["key"]) => {
    if (!result) return;
    if (key === "priority") update.mutate({ id: ticket.id, patch: { priority: result.priority } });
    else update.mutate({ id: ticket.id, patch: { tags: [...ticket.tags.map((x) => x.name), ...newTags] } });
  };

  const applyAll = async () => {
    setApplying(true);
    try {
      const res = await api.ai.triage(ticket.id, true);
      creditsSpent(qc);
      const fresh = await api.tickets.get(ticket.id);
      patchCachedTicket(qc, fresh, me);
      setResult({ ...res, applied: true });
      setTimeout(() => setResult(null), 1600);
    } catch (e) {
      reportAiError(e, t("triage.failed"));
    } finally {
      setApplying(false);
    }
  };

  if (!result)
    return (
      <section className="border-b border-line-soft px-4 py-3">
        <AiTooltip feature="triage" label={t("triage.suggest")}>
          <button
            type="button"
            onClick={() => void suggest()}
            disabled={busy}
            className="group flex h-7 w-full items-center gap-2 rounded-md px-2 -mx-2 text-[12.5px] text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-60"
          >
            <AiIcon className={cn("size-3 text-fg-4 group-hover:text-fg-3", busy && "animate-pulse-soft")} />
            <span className="flex-1 text-left">{busy ? t("triage.working") : t("triage.suggest")}</span>
          </button>
        </AiTooltip>
      </section>
    );

  return (
    <section className="border-b border-line-soft px-4 py-3.5 animate-fade-in" aria-label={t("triage.title")}>
      <SectionHead title={t("triage.title")}>
        <Tooltip content={t("triage.dismiss")}>
          <button type="button" aria-label={t("triage.dismiss")} onClick={() => setResult(null)} className="flex size-5 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-fg">
            <X className="size-3" />
          </button>
        </Tooltip>
      </SectionHead>
      <dl className="flex flex-col gap-1.5 text-[12px]">
        <div className="flex min-h-6 items-center gap-2">
          <dt className="w-[70px] shrink-0 text-fg-3">{t("triage.priority")}</dt>
          <dd className="flex min-w-0 flex-1 items-center gap-1.5 text-fg">
            <PriorityIcon priority={result.priority} />
            {priorityLabel[result.priority]}
          </dd>
          <ApplyButton pending={rows[0].pending} onClick={() => applyRow("priority")} />
        </div>
        <div className="flex min-h-6 items-start gap-2">
          <dt className="w-[70px] shrink-0 pt-1 text-fg-3">{t("triage.tags")}</dt>
          <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1 pt-0.5">
            {result.tags.map((x) => (
              <span key={x} className={cn(!current.has(x.toLowerCase()) ? "" : "opacity-50")}>
                <TagChip name={x} />
              </span>
            ))}
            {(result.suggested_tags ?? []).map((x) => (
              <Tooltip key={`new-${x}`} content={t("triage.newTag")}>
                <span className="rounded-[4px] border border-dashed border-line-strong px-1 text-[11.5px] text-fg-3">+ {x}</span>
              </Tooltip>
            ))}
          </dd>
          <ApplyButton pending={rows[1].pending} onClick={() => applyRow("tags")} />
        </div>
        <div className="flex min-h-6 items-center gap-2">
          <dt className="w-[70px] shrink-0 text-fg-3">{t("triage.sentiment")}</dt>
          <dd className="text-fg">
            <SentimentLabel s={result.sentiment} />
          </dd>
        </div>
        <div className="flex min-h-6 items-center gap-2">
          <dt className="w-[70px] shrink-0 text-fg-3">{t("triage.language")}</dt>
          <dd className="text-fg-2">{languageName(result.language)}</dd>
        </div>
        {result.category && (
          <div className="flex min-h-6 items-center gap-2">
            <dt className="w-[70px] shrink-0 text-fg-3">{t("triage.category")}</dt>
            <dd className="truncate text-fg-2">{result.category}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 flex items-center gap-2">
        {result.applied ? (
          <span className="flex items-center gap-1.5 text-[12px] text-fg-2">
            <Check className="size-3.5" /> {t("triage.appliedToast")}
          </span>
        ) : anyPending ? (
          <>
            <Button size="xs" variant="primary" loading={applying} onClick={() => void applyAll()}>
              {t("triage.applyAll")}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setResult(null)}>
              {t("triage.dismiss")}
            </Button>
          </>
        ) : (
          <span className="text-[12px] text-fg-3">{t("triage.nothing")}</span>
        )}
      </div>
    </section>
  );
}

function ApplyButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  const { t } = useTranslation("aiTicket");
  if (!pending)
    return (
      <span className="flex h-5 shrink-0 items-center gap-1 text-[11px] text-fg-4">
        <Check className="size-3" /> {t("triage.applied")}
      </span>
    );
  return (
    <button type="button" onClick={onClick} className="h-5 shrink-0 rounded px-1.5 text-[11px] font-medium text-fg-2 hover:bg-hover hover:text-fg">
      {t("triage.apply")}
    </button>
  );
}

type Turn = { id: number; question: string; text: string; answer: AIAnswer | null; error?: boolean };

function AskBox({ t: ticket }: { t: Ticket }) {
  const { t } = useTranslation("aiTicket");
  const qc = useQueryClient();
  const credits = useCreditLabel()("copilot");
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const busy = turns.some((x) => !x.answer && !x.error);

  useEffect(() => {
    setTurns([]);
    return () => abort.current?.abort();
  }, [ticket.id]);

  const ask = async () => {
    const qn = question.trim();
    if (!qn || busy) return;
    const id = Date.now();
    setQuestion("");
    setTurns((x) => [...x.slice(-2), { id, question: qn, text: "", answer: null }]);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const answer = await api.ai.ask(ticket.id, qn, {
        signal: ac.signal,
        onDelta: (_d, soFar) => setTurns((x) => x.map((y) => (y.id === id ? { ...y, text: soFar } : y))),
      });
      setTurns((x) => x.map((y) => (y.id === id ? { ...y, answer } : y)));
      creditsSpent(qc);
    } catch (e) {
      setTurns((x) => (isAbort(e) ? x.filter((y) => y.id !== id) : x.map((y) => (y.id === id ? { ...y, error: true } : y))));
      reportAiError(e, t("ask.failed"));
    } finally {
      abort.current = null;
    }
  };

  return (
    <section className="border-b border-line-soft px-4 py-3.5">
      <SectionHead title={t("ask.title")}>
        {turns.length > 0 && !busy && (
          <button type="button" onClick={() => setTurns([])} className="text-[11px] text-fg-4 hover:text-fg">
            {t("ask.clear")}
          </button>
        )}
      </SectionHead>
      {turns.length > 0 && (
        <div className="mb-2.5 flex flex-col gap-3" aria-live="polite">
          {turns.map((x) => (
            <div key={x.id} className="flex flex-col gap-1.5 animate-fade-in">
              <p className="self-end rounded-md bg-hover px-2 py-1 text-[12px] text-fg" data-ph-mask>
                {x.question}
              </p>
              {x.error ? (
                <p className="text-[12px] text-fg-3">{t("ask.failed")}</p>
              ) : x.answer ? (
                <>
                  <div className="prose-od text-[12.5px] leading-[19px] [&_li]:my-0.5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4" data-ph-mask dangerouslySetInnerHTML={{ __html: sanitizeHtml(x.answer.answer_html) }} />
                  {x.answer.sources.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10.5px] text-fg-4">{t("ask.sources")}</span>
                      {x.answer.sources.map((s) => (
                        <a key={s.article_id} href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11.5px] text-fg-2 hover:text-fg hover:underline">
                          <BookOpen className="size-3 shrink-0 text-fg-4" />
                          <span className="truncate">{s.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </>
              ) : x.text ? (
                <div className="prose-od text-[12.5px] leading-[19px] [&_li]:my-0.5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4" data-ph-mask dangerouslySetInnerHTML={{ __html: streamTextToHtml(x.text) }} />
              ) : (
                <span className="flex items-center gap-1.5 text-[12px] text-fg-3">
                  <AiIcon className="size-3 animate-pulse-soft" /> {t("ask.thinking")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="flex h-8 items-center gap-1 rounded-md border border-line bg-surface pl-2.5 pr-1 focus-within:border-fg-4 focus-within:shadow-[0_0_0_3px_var(--focus)]"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("ask.placeholder")}
          aria-label={t("ask.title")}
          maxLength={500}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-fg-4"
        />
        <Tooltip content={credits ? `${t("ask.send")} · ${credits}` : t("ask.send")}>
          <button
            type="submit"
            aria-label={t("ask.send")}
            disabled={!question.trim() || busy}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-inverse text-inverse-fg transition-opacity disabled:opacity-25"
          >
            <ArrowUp className="size-3.5" />
          </button>
        </Tooltip>
      </form>
    </section>
  );
}

/** All AI sections of the side panel; nothing renders when AI is off. */
export function TicketAiPanel({ t }: { t: Ticket }) {
  const ai = useAI();
  const role = useRole();
  if (!ai.enabled) return null;
  const agent = atLeast(role, "agent");
  return (
    <>
      <SummaryCard t={t} />
      {agent && <TriageCard t={t} />}
      <AskBox t={t} />
    </>
  );
}
