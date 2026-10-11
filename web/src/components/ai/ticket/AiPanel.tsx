// AI in the ticket side panel: a summary insight card with its key points, a
// triage recommendation with a confidence meter and per-change approval, and a
// copilot box to ask questions about the conversation. Card patterns adapted
// from Beautiful UI (MIT, see web/THIRD_PARTY_NOTICES.md and ../ui/).

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, RotateCw, X } from "lucide-react";
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
import { SentimentIcon } from "@/components/indicators";
import { PriorityIcon, priorityLabel } from "@/components/tickets/bits";
import { useUpdateTicket } from "@/components/tickets/useTicketActions";
import { AiIcon, AiTooltip, useCreditLabel } from "../bits";
import { AiCard, AiCardFooter, AiCardHeader, ContextList } from "../ui/Cards";
import { ApprovalRows, Confidence, DonePill, type ApprovalRow, type Signal } from "../ui/Recommendation";
import { SourceChips, StreamingHtml } from "../ui/StreamingText";
import { ShimmerText, Thinking, formatElapsed, useElapsed } from "../ui/Thinking";
import { PromptBar } from "../ui/PromptBar";
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

function SentimentLabel({ s }: { s: Sentiment }) {
  const { t } = useTranslation("aiTicket");
  return (
    <span className="inline-flex items-center gap-1.5 text-fg-2">
      <SentimentIcon sentiment={s} className="size-3.5" />
      {t(`sentiment.${s}`)}
    </span>
  );
}

const iconBtn = "flex size-6 items-center justify-center rounded-md text-fg-4 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40";

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

  if (!stored)
    return (
      <AiCard label={t("summary.title")} busy={busy}>
        <AiCardHeader title={t("summary.title")} />
        {busy ? (
          <div className="flex flex-col gap-2 px-3 pb-3" aria-label={t("summary.working")}>
            <Thinking working label={t("summary.working")} />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-[86%]" />
            <Skeleton className="h-2.5 w-[64%]" />
          </div>
        ) : (
          <div className="flex items-center gap-3 px-3 pb-3">
            <p className="min-w-0 flex-1 text-[12px] leading-[17px] text-fg-3">{t("summary.empty")}</p>
            <AiTooltip feature="summarize" label={t("summary.generate")}>
              <Button size="xs" variant="secondary" onClick={() => void run()} aria-label={`${t("summary.generate")}${credits ? `, ${credits}` : ""}`}>
                {t("summary.generate")}
              </Button>
            </AiTooltip>
          </div>
        )}
      </AiCard>
    );

  return (
    <AiCard label={t("summary.title")} busy={busy}>
      <AiCardHeader title={t("summary.title")} count={stored.key_points.length ? t("summary.points", { count: stored.key_points.length }) : undefined}>
        <AiTooltip feature="summarize" label={t("summary.refresh")}>
          <button type="button" aria-label={t("summary.refresh")} onClick={() => void run()} disabled={busy} className={iconBtn}>
            <RotateCw className={cn("size-3", busy && "animate-spin")} />
          </button>
        </AiTooltip>
      </AiCardHeader>
      <div className={cn("px-3 pb-2 transition-opacity duration-200", busy && "opacity-50")} data-ph-mask>
        <p className="text-[12.5px] leading-[19px] text-fg">{stored.summary}</p>
        {stored.key_points.length > 0 && <ContextList className="mt-2" items={stored.key_points} />}
      </div>
      <AiCardFooter className="min-h-8 text-[11px] text-fg-4">
        <SentimentLabel s={stored.sentiment} />
        <span aria-hidden>·</span>
        <Tooltip content={fullDate(stored.updated_at)}>
          <span className="truncate">{t("summary.updated", { when: relLong(stored.updated_at) })}</span>
        </Tooltip>
      </AiCardFooter>
    </AiCard>
  );
}

type ChangeKey = "priority" | "tags" | "new_tags";

/** How sure the suggestion is: the server's score when it sends one, else how well it fits the workspace. */
function triageSignal(r: Triage): Signal {
  const c = (r as Triage & { confidence?: unknown }).confidence;
  if (typeof c === "number") return c >= 0.8 ? 3 : c >= 0.5 ? 2 : 1;
  let s = 3;
  if (!r.tags.length) s--;
  if (r.suggested_tags?.length) s--;
  if (!r.category) s--;
  return Math.max(1, s) as Signal;
}

function TriageCard({ t: ticket }: { t: Ticket }) {
  const { t } = useTranslation("aiTicket");
  const qc = useQueryClient();
  const me = useSession((s) => s.user?.id ?? "");
  const update = useUpdateTicket();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Triage | null>(null);
  const [off, setOff] = useState<Set<ChangeKey>>(new Set());
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new ticket gets a fresh suggestion.
  useEffect(() => {
    setResult(null);
    setOff(new Set());
  }, [ticket.id]);
  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const suggest = async () => {
    setBusy(true);
    try {
      setResult(await api.ai.triage(ticket.id, false));
      setOff(new Set());
      creditsSpent(qc);
    } catch (e) {
      reportAiError(e, t("triage.failed"));
    } finally {
      setBusy(false);
    }
  };

  const settle = (r: Triage) => {
    setResult({ ...r, applied: true });
    clearTimer.current = setTimeout(() => setResult(null), 1600);
  };

  const applyAll = useMutation({
    mutationFn: async () => {
      const res = await api.ai.triage(ticket.id, true);
      creditsSpent(qc);
      const fresh = await api.tickets.get(ticket.id);
      patchCachedTicket(qc, fresh, me);
      return res;
    },
    onSuccess: settle,
    onError: (e) => reportAiError(e, t("triage.failed")),
  });

  if (!result)
    return (
      <AiTooltip feature="triage" label={t("triage.suggest")}>
        <button
          type="button"
          onClick={() => void suggest()}
          disabled={busy}
          aria-busy={busy || undefined}
          className="group flex h-9 w-full items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 text-[12.5px] text-fg-2 transition-colors hover:border-solid hover:border-line hover:bg-hover hover:text-fg disabled:cursor-default disabled:border-solid disabled:border-line disabled:bg-surface"
        >
          <AiIcon className={cn("size-3.5", busy && "animate-pulse-soft")} />
          <span className="flex-1 text-left">{busy ? <ShimmerText>{t("triage.working")}</ShimmerText> : t("triage.suggest")}</span>
          {!busy && <ArrowRight className="size-3.5 text-fg-4 opacity-0 transition-opacity group-hover:opacity-100" />}
        </button>
      </AiTooltip>
    );

  const current = new Set(ticket.tags.map((x) => x.name.toLowerCase()));
  const addTags = result.tags.filter((x) => !current.has(x.toLowerCase()));
  const createTags = (result.suggested_tags ?? []).filter((x) => !current.has(x.toLowerCase()));
  const pending: ChangeKey[] = [
    ...(result.priority !== ticket.priority ? (["priority"] as const) : []),
    ...(addTags.length ? (["tags"] as const) : []),
    ...(createTags.length ? (["new_tags"] as const) : []),
  ];
  const chosen = pending.filter((k) => !off.has(k));
  const all = chosen.length === pending.length;
  const signal = triageSignal(result);

  const rows: ApprovalRow[] = pending.map((key) => ({
    key,
    checked: !off.has(key),
    disabled: applyAll.isPending,
    label: t(`triage.${key === "new_tags" ? "newTags" : key}`),
    value:
      key === "priority" ? (
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-1 text-fg-3">
            <PriorityIcon priority={ticket.priority} muted />
            <span className="sr-only">{priorityLabel[ticket.priority]}</span>
          </span>
          <ArrowRight className="size-3 text-fg-4" aria-hidden />
          <PriorityIcon priority={result.priority} />
          {priorityLabel[result.priority]}
        </span>
      ) : key === "tags" ? (
        addTags.map((x) => <TagChip key={x} name={x} color={ticket.tags.find((g) => g.name.toLowerCase() === x.toLowerCase())?.color} />)
      ) : (
        createTags.map((x) => (
          <Tooltip key={x} content={t("triage.newTag")}>
            <span className="inline-flex h-[18px] items-center rounded-sm border border-dashed border-line-strong px-1.5 text-[11px] text-fg-3">+ {x}</span>
          </Tooltip>
        ))
      ),
  }));

  const applyChosen = () => {
    if (all) return applyAll.mutate();
    const patch: { priority?: Triage["priority"]; tags?: string[] } = {};
    if (chosen.includes("priority")) patch.priority = result.priority;
    const extra = [...(chosen.includes("tags") ? addTags : []), ...(chosen.includes("new_tags") ? createTags : [])];
    if (extra.length) patch.tags = [...ticket.tags.map((x) => x.name), ...extra];
    update.mutate({ id: ticket.id, patch }, { onSuccess: () => settle(result) });
  };

  const facts: [string, React.ReactNode][] = [
    ...(pending.includes("priority")
      ? []
      : ([[t("triage.priority"), (
          <span className="flex items-center gap-1.5">
            <PriorityIcon priority={result.priority} />
            {priorityLabel[result.priority]}
            <Check className="size-3 text-fg-4" aria-label={t("triage.applied")} />
          </span>
        )]] as [string, React.ReactNode][])),
    [t("triage.sentiment"), <SentimentLabel key="s" s={result.sentiment} />],
    [t("triage.language"), languageName(result.language)],
    ...(result.category ? ([[t("triage.category"), <span key="c" className="truncate">{result.category}</span>]] as [string, React.ReactNode][]) : []),
  ];

  return (
    <AiCard label={t("triage.title")}>
      <AiCardHeader title={t("triage.title")}>
        <Tooltip content={t("triage.dismiss")}>
          <button type="button" aria-label={t("triage.dismiss")} onClick={() => setResult(null)} className={iconBtn}>
            <X className="size-3" />
          </button>
        </Tooltip>
      </AiCardHeader>
      {result.summary && (
        <p className="px-3 pb-2 text-[12.5px] leading-[19px] text-fg" data-ph-mask>
          {result.summary}
        </p>
      )}
      <dl className="flex flex-col gap-1 px-3 pb-2.5 text-[12px]">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-h-5 items-center gap-2.5">
            <dt className="w-[62px] shrink-0 text-fg-3">{k}</dt>
            <dd className="flex min-w-0 items-center text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
      {pending.length > 0 && !result.applied && (
        <div className="border-t border-line-soft px-3 pb-1.5 pt-2">
          <p className="label-caps pb-1">{t("triage.changes")}</p>
          <ApprovalRows rows={rows} onToggle={(k, v) => setOff((s) => { const n = new Set(s); if (v) n.delete(k as ChangeKey); else n.add(k as ChangeKey); return n; })} />
        </div>
      )}
      <AiCardFooter>
        {result.applied ? (
          <DonePill>{t("triage.appliedToast")}</DonePill>
        ) : (
          <>
            <Tooltip content={t("triage.confidenceHint")}>
              <span className="min-w-0">
                <Confidence signal={signal} label={t(`triage.confidence.${signal}`)} />
              </span>
            </Tooltip>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {pending.length > 0 ? (
                <Button size="xs" variant="primary" loading={applyAll.isPending} disabled={!chosen.length} onClick={applyChosen}>
                  {all ? t("triage.applyAll") : t("triage.applySome", { count: chosen.length })}
                </Button>
              ) : (
                <span className="text-[11.5px] text-fg-3">{t("triage.nothing")}</span>
              )}
            </span>
          </>
        )}
      </AiCardFooter>
    </AiCard>
  );
}

type Turn = { id: number; question: string; text: string; answer: AIAnswer | null; error?: boolean; started: number; took?: number };

function TurnView({ x }: { x: Turn }) {
  const { t } = useTranslation("aiTicket");
  const working = !x.answer && !x.error;
  const elapsed = useElapsed(working);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="max-w-[88%] self-end rounded-md bg-hover px-2 py-1 text-[12px] text-fg" data-ph-mask>
        {x.question}
      </p>
      {x.error ? (
        <p className="text-[12px] text-danger-fg">{t("ask.failed")}</p>
      ) : x.answer ? (
        <>
          <Thinking working={false} label={t("ask.thinking")} doneLabel={t("ask.answered", { time: formatElapsed(x.took ?? 0) })} />
          <StreamingHtml html={sanitizeHtml(x.answer.answer_html)} />
          <SourceChips sources={x.answer.sources} label={t("ask.sources")} className="mt-0.5" />
        </>
      ) : x.text ? (
        <>
          <Thinking working label={t("ask.writing")} trailing={<span className="mono text-[10.5px] tabular-nums text-fg-4">{formatElapsed(elapsed)}</span>} />
          <StreamingHtml html={streamTextToHtml(x.text)} streaming />
        </>
      ) : (
        <Thinking working label={t("ask.thinking")} trailing={<span className="mono text-[10.5px] tabular-nums text-fg-4">{formatElapsed(elapsed)}</span>} />
      )}
    </div>
  );
}

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
    setTurns((x) => [...x.slice(-2), { id, question: qn, text: "", answer: null, started: id }]);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const answer = await api.ai.ask(ticket.id, qn, {
        signal: ac.signal,
        onDelta: (_d, soFar) => setTurns((x) => x.map((y) => (y.id === id ? { ...y, text: soFar } : y))),
      });
      const took = (Date.now() - id) / 1000;
      setTurns((x) => x.map((y) => (y.id === id ? { ...y, answer, took } : y)));
      creditsSpent(qc);
    } catch (e) {
      setTurns((x) => (isAbort(e) ? x.filter((y) => y.id !== id) : x.map((y) => (y.id === id ? { ...y, error: true } : y))));
      reportAiError(e, t("ask.failed"));
    } finally {
      abort.current = null;
    }
  };

  return (
    <AiCard>
      <AiCardHeader title={t("ask.title")}>
        {turns.length > 0 && !busy && (
          <button type="button" onClick={() => setTurns([])} className="h-6 rounded-md px-1.5 text-[11px] text-fg-4 transition-colors hover:bg-hover hover:text-fg">
            {t("ask.clear")}
          </button>
        )}
      </AiCardHeader>
      {turns.length > 0 && (
        <div className="flex flex-col gap-3.5 px-3 pb-3" aria-live="polite">
          {turns.map((x) => (
            <TurnView key={x.id} x={x} />
          ))}
        </div>
      )}
      <div className="px-2 pb-2">
        <PromptBar
          value={question}
          onChange={setQuestion}
          onSubmit={() => void ask()}
          placeholder={t("ask.placeholder")}
          label={t("ask.title")}
          sendLabel={t("ask.send")}
          sendHint={credits ? `${t("ask.send")} · ${credits}` : t("ask.send")}
          busy={busy}
          maxLength={500}
        />
      </div>
    </AiCard>
  );
}

/** All AI sections of the side panel; nothing renders when AI is off. */
export function TicketAiPanel({ t }: { t: Ticket }) {
  const ai = useAI();
  const role = useRole();
  if (!ai.enabled) return null;
  const agent = atLeast(role, "agent");
  return (
    <div className="flex flex-col gap-2.5 border-b border-line-soft px-4 py-3.5">
      <SummaryCard t={t} />
      {agent && <TriageCard t={t} />}
      <AskBox t={t} />
    </div>
  );
}
