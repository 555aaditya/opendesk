import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lockup } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty";
import { Notice } from "@/components/auth/parts";
import { api } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import { LanguageSwitcher, usePublicLocale } from "@/components/help/locale";
import "@/components/help/help.css";
import { cn } from "@/lib/cn";
import { q } from "@/lib/queries";

const route = getRouteApi("/csat/$token");

/**
 * Email links land here with ?score=1..5. The router reads a bare number as a
 * number, not the string its search schema keeps, so read the score from the
 * URL this page was loaded with.
 */
function landingScore(token: string): string | undefined {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const url = new URL(nav?.name ?? location.href);
    return url.pathname.endsWith(`/csat/${token}`) ? (url.searchParams.get("score") ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

/** A line face; the mouth curves from frown (1) to smile (5). */
function Face({ score, active }: { score: number; active: boolean }) {
  const curve = (score - 3) * 3.2; // -6.4 .. 6.4
  return (
    <svg viewBox="0 0 40 40" className="size-9" aria-hidden fill="none">
      <circle cx="20" cy="20" r="17" className={active ? "fill-inverse" : "fill-transparent"} stroke="currentColor" strokeWidth={active ? 0 : 1.4} />
      <circle cx="14.2" cy="16.5" r="1.7" className={active ? "fill-inverse-fg" : "fill-current"} />
      <circle cx="25.8" cy="16.5" r="1.7" className={active ? "fill-inverse-fg" : "fill-current"} />
      <path
        d={`M12.5 ${26 - curve / 2} Q20 ${26 + curve} 27.5 ${26 - curve / 2}`}
        strokeWidth="1.8"
        strokeLinecap="round"
        className={active ? "stroke-inverse-fg" : "stroke-current"}
      />
    </svg>
  );
}

export default function Csat() {
  const { token } = route.useParams();
  const search = route.useSearch();
  const { data, isLoading, isError, isPending } = useQuery(q.csat(token));
  const { locale, loaded } = usePublicLocale(data?.locale || undefined, !isPending);
  const { t } = useTranslation("public");
  const label = (n: number) => t(`csat.scores.${n as 1 | 2 | 3 | 4 | 5}`);
  const pre = Number(search.score ?? landingScore(token));
  const [score, setScore] = useState<number | null>(pre >= 1 && pre <= 5 ? pre : null);
  const [comment, setComment] = useState("");
  const [sentScore, setSentScore] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const auto = useRef(false);

  const submit = useMutation({
    mutationFn: (b: { score: number; comment?: string }) => api.public.submitCsat(token, b),
    onSuccess: (_d, b) => setSentScore(b.score),
  });

  // A score clicked in the email is recorded right away; the comment is optional after.
  useEffect(() => {
    if (auto.current || !data || data.score !== null || !(pre >= 1 && pre <= 5)) return;
    auto.current = true;
    submit.mutate({ score: pre });
  }, [data, pre, submit]);

  useEffect(() => {
    if (loaded) document.title = t("csat.page_title");
  }, [loaded, t]);

  const rated = data?.score != null && sentScore === null;

  return (
    <div data-public-page className="flex min-h-dvh flex-col items-center bg-surface px-4">
      <main className="flex w-full max-w-[460px] flex-1 flex-col justify-center py-16">
        {isLoading || !loaded ? (
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-72" />
            <Skeleton className="mt-6 h-16 w-full rounded-lg" />
          </div>
        ) : isError || !data ? (
          <EmptyState lit={2} title={t("csat.invalid_title")} description={t("csat.invalid_body")} />
        ) : rated ? (
          <Done title={t("csat.already_title")} body={t("csat.already_body")} />
        ) : finished ? (
          <Done title={t("csat.thanks_title")} body={data.workspace_name ? t("csat.thanks_body", { name: data.workspace_name }) : t("csat.thanks_body_generic")} />
        ) : (
          <div className="text-center">
            {data.workspace_name && (
              <p className="label-caps mb-3">
                <bdi>{data.workspace_name}</bdi>
              </p>
            )}
            <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.03em]">{t("csat.question")}</h1>
            {data.ticket?.subject && (
              <p className="mx-auto mt-2 max-w-[380px] truncate text-[13px] text-fg-3">
                {data.ticket.number ? (
                  <>
                    <bdi className="mono">#{data.ticket.number}</bdi>{" "}
                  </>
                ) : null}
                <bdi>{data.ticket.subject}</bdi>
              </p>
            )}
            <div role="radiogroup" aria-label={t("csat.rating")} className="mt-8 grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={score === n}
                  aria-label={t("csat.score_label", { score: n, label: label(n) })}
                  onClick={() => setScore(n)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border px-1 py-3 transition-[border-color,background-color,color] duration-100",
                    score === n ? "border-fg text-fg" : "border-line text-fg-3 hover:border-line-strong hover:text-fg",
                  )}
                >
                  <Face score={n} active={score === n} />
                  <span className="text-[11.5px] leading-tight">{label(n)}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 text-start">
              <label htmlFor="csat-comment" className="text-[12.5px] font-medium">
                {t("csat.comment_label")} <span className="font-normal text-fg-4">{t("csat.optional")}</span>
              </label>
              <Textarea id="csat-comment" className="mt-1.5 min-h-[96px]" value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} placeholder={t("csat.comment_placeholder")} />
            </div>
            {submit.isError && (
              <Notice className="mt-4 text-start">{isApiError(submit.error, "network_error") ? t("csat.offline") : t("csat.error")}</Notice>
            )}
            {sentScore !== null && !submit.isPending && <p className="mt-4 text-[12.5px] text-fg-3" aria-live="polite">{t("csat.saved")}</p>}
            <Button
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              disabled={!score}
              loading={submit.isPending}
              onClick={() => score && submit.mutate({ score, comment: comment.trim() || undefined }, { onSuccess: () => setFinished(true) })}
            >
              {sentScore !== null && sentScore === score ? t("csat.send_comment") : t("csat.send_feedback")}
            </Button>
          </div>
        )}
      </main>
      <footer className="flex h-14 items-center gap-3 text-xs text-fg-4">
        <LanguageSwitcher current={locale} />
        <span className="flex items-center gap-1.5">
          {t("footer.powered_by")} <Lockup className="h-[11px]" />
        </span>
      </footer>
    </div>
  );
}

function Done({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center" aria-live="polite">
      <span className="mb-5 flex size-11 items-center justify-center rounded-full bg-inverse text-inverse-fg">
        <Check className="size-5" strokeWidth={2.5} />
      </span>
      <h1 className="text-[22px] font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-1.5 text-[13px] text-fg-3">{body}</p>
    </div>
  );
}
