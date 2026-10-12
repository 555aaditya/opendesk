// The AI agent's setup checklist (GET /v1/ai/agent/setup) for Settings > AI agent >
// Overview: one row per step with its state, why it matters and a link to the page
// that does it. Open until every required step is done, then folded into one line
// that can be opened again.

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useId, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedNumber } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentSetup, AgentSetupStep } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { ease, springs } from "@/lib/motion";
import { q } from "@/lib/queries";
import { AI_TONE, tone } from "@/lib/tones";
import { blockedBy, nextStep, setupProgress, startsOpen } from "./setup";

/** Fetches the checklist; quiet while loading, a one-line retry on error. */
export function AgentSetupPanel({ className }: { className?: string }) {
  const { t } = useTranslation("aiSetup");
  const setup = useQuery(q.agentSetup());
  if (setup.isLoading) return <Skeleton className={cn("h-[76px] rounded-lg", className)} />;
  if (setup.isError || !setup.data)
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-[12.5px] text-fg-3 shadow-xs", className)}>
        <span className="flex-1">{t("setup.error")}</span>
        <Button size="xs" onClick={() => void setup.refetch()}>
          {t("setup.retry")}
        </Button>
      </div>
    );
  return <AgentSetupCard setup={setup.data} className={className} />;
}

export function AgentSetupCard({ setup, className }: { setup: AgentSetup; className?: string }) {
  const { t } = useTranslation("aiSetup");
  const reduce = useReducedMotion();
  const listId = useId();
  const { done, total, pct, complete } = setupProgress(setup);
  const [open, setOpen] = useState(() => startsOpen(setup));
  // Finishing the last step while watching folds the list after its check draws.
  useEffect(() => {
    if (!complete) return setOpen(true);
    const id = setTimeout(() => setOpen(false), reduce ? 0 : 900);
    return () => clearTimeout(id);
  }, [complete, reduce]);
  const next = nextStep(setup);
  const [pre, post] = t("setup.progress", { done: "\u0001", total }).split("\u0001");

  return (
    <section
      aria-label={t("setup.title")}
      className={cn("overflow-hidden rounded-lg border border-line bg-surface shadow-xs animate-rise-in", className)}
    >
      <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <span className={cn("mt-px flex size-7 shrink-0 items-center justify-center rounded-md", complete ? tone.green.soft : tone[AI_TONE].soft)}>
          {complete ? <Check className={cn("size-3.5", tone.green.text)} /> : <Sparkles className={cn("size-3.5", tone[AI_TONE].text)} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-fg">{complete ? t("setup.complete") : t("setup.title")}</h2>
            <span className="text-[12px] tabular-nums text-fg-3" aria-label={t("setup.progressLabel", { done, total })}>
              <span aria-hidden>
                {pre}
                <AnimatedNumber value={done} />
                {post}
              </span>
            </span>
          </div>
          <p className="mt-0.5 text-[12px] leading-[18px] text-fg-3">{complete ? t("setup.completeBody") : t("setup.description")}</p>
        </div>
        {complete && (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            iconRight={
              <ChevronDown className={cn("size-3 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
            }
            className="-me-1.5 shrink-0 text-fg-3"
          >
            {open ? t("setup.hideSteps") : t("setup.showSteps")}
          </Button>
        )}
      </header>
      <div className="px-4 pb-3">
        <div
          className="h-1 overflow-hidden rounded-xs bg-hover"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={t("setup.progressLabel", { done, total })}
        >
          <motion.div
            className="h-full rounded-xs bg-tone-green-solid"
            initial={false}
            animate={{ width: `${pct * 100}%` }}
            transition={reduce ? { duration: 0 } : springs.glide}
          />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            id={listId}
            key="steps"
            className="border-t border-line-soft"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: ease.out }}
          >
            {setup.steps.map((s) => (
              <StepRow key={s.id} step={s} next={s.id === next?.id} blocked={!!blockedBy(s, setup.steps)} />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}

function StepRow({ step, next, blocked }: { step: AgentSetupStep; next: boolean; blocked: boolean }) {
  const { t } = useTranslation("aiSetup");
  const router = useRouter();
  const reduce = useReducedMotion();
  const key = `setup.steps.${step.id}` as const;
  const title = t(`${key}.title`, { defaultValue: step.title });
  const why = t(`${key}.why`, { defaultValue: step.description });
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    router.history.push(step.href);
  };
  const preload = () => void router.preloadRoute({ to: step.href as never }).catch(() => undefined);

  return (
    <li
      className={cn(
        "flex items-start gap-3 border-b border-line-soft px-4 py-2.5 last:border-0 transition-colors duration-150",
        next && "bg-sunken",
      )}
      data-step={step.id}
      data-done={step.done || undefined}
    >
      <motion.span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-200",
          step.done ? "border-transparent bg-tone-green-solid text-white" : "border-line-strong bg-surface",
        )}
        initial={false}
        animate={step.done && !reduce ? { scale: [0.8, 1.08, 1] } : { scale: 1 }}
        transition={reduce ? { duration: 0 } : springs.snap}
      >
        {step.done && <Check className="size-2.5" strokeWidth={3} />}
      </motion.span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn("text-[13px]", step.done ? "text-fg-3" : "font-medium text-fg")}>{title}</span>
          {step.optional && (
            <span className="inline-flex h-[18px] items-center rounded-sm bg-hover px-1.5 text-[10.5px] text-fg-3">{t("setup.optional")}</span>
          )}
          <span className="sr-only">{step.done ? t("setup.stepDone") : t("setup.stepTodo")}</span>
        </div>
        <p className={cn("mt-0.5 text-[12px] leading-[18px]", step.done ? "text-fg-4" : "text-fg-3")}>
          {blocked ? t("setup.needsAi") : why}
        </p>
      </div>
      {!step.done && !blocked && (
        <Button
          asChild
          size="xs"
          variant={next ? "primary" : "secondary"}
          className="mt-0.5 shrink-0"
        >
          <a href={step.href} onClick={go} onMouseEnter={preload} onFocus={preload}>
            {t(`${key}.action`, { defaultValue: title })}
            <ArrowRight className="size-3 rtl:-scale-x-100" />
          </a>
        </Button>
      )}
    </li>
  );
}
