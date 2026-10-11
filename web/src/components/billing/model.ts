// Pure billing helpers: money, limits, credits and usage series. No React.

import type { AIFeature, Billing, BillingUsage, Price } from "@/lib/api/types";

/** Fraction digits a currency uses (USD 2, JPY 0). Stripe amounts are in those minor units. */
export function currencyDigits(currency: string, locale = "en"): number {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** "$19", "$19.50", "€190", "¥2,000". Whole amounts drop the decimals. */
export function formatMoney(minor: number, currency: string, locale = "en"): string {
  const digits = currencyDigits(currency, locale);
  const major = minor / 10 ** digits;
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${major} ${currency.toUpperCase()}`;
  }
}

export function formatPrice(p: Price, locale = "en", quantity = 1): string {
  return formatMoney(p.unit_amount * quantity, p.currency, locale);
}

/** Percent saved by paying yearly, or null when the prices can't be compared. */
export function yearlySavings(month: Price | null, year: Price | null): number | null {
  if (!month || !year || month.currency !== year.currency || month.unit_amount <= 0) return null;
  const pct = Math.round((1 - year.unit_amount / (month.unit_amount * 12)) * 100);
  return pct > 0 ? pct : null;
}

export type LimitKind = "mailboxes" | "members";

export type LimitState = {
  /** The plan caps this at all. */
  limited: boolean;
  used: number;
  max: number;
  /** Creating one more would be refused. */
  atLimit: boolean;
  /** Already past the cap (after a downgrade). */
  over: boolean;
};

export function limitState(b: Billing | null | undefined, kind: LimitKind): LimitState {
  const max = b ? (kind === "mailboxes" ? b.limits.max_mailboxes : b.limits.max_members) : 0;
  const used = b ? b.usage[kind] : 0;
  const limited = !!b && max > 0;
  return { limited, used, max, atLimit: limited && used >= max, over: limited && used > max };
}

export type CreditBreakdown = {
  unlimited: boolean;
  monthly: number;
  /** Monthly allowance spent so far (capped at the allowance). */
  monthlyUsed: number;
  monthlyLeft: number;
  /** Purchased credits still available. */
  purchased: number;
  remaining: number;
  /** 0..1 of the allowance spent. */
  ratio: number;
  low: boolean;
};

export function creditBreakdown(c: Billing["credits"]): CreditBreakdown {
  const monthlyUsed = Math.min(c.used, c.monthly);
  const monthlyLeft = Math.max(0, c.monthly - c.used);
  const ratio = c.monthly > 0 ? monthlyUsed / c.monthly : 0;
  return {
    unlimited: c.unlimited,
    monthly: c.monthly,
    monthlyUsed,
    monthlyLeft,
    purchased: c.purchased,
    remaining: c.remaining,
    ratio,
    low: !c.unlimited && c.remaining <= Math.max(5, c.monthly * 0.1),
  };
}

/** The workspace has a Stripe subscription to manage. */
export function hasSubscription(b: Billing): boolean {
  return b.billing_enabled && b.plan === "pro" && b.status !== "none";
}

export function isSelfHosted(b: Billing): boolean {
  return b.plan === "self_hosted" || !b.billing_enabled;
}

// ─── Usage series ──────────────────────────────────────────────────────────

export const FEATURES: AIFeature[] = ["draft_reply", "answer", "copilot", "summarize", "rewrite", "translate", "triage", "kb_draft"];

/** Every day from `from` to `to` (YYYY-MM-DD, inclusive), in UTC. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export type Stack = { key: AIFeature | "other"; credits: number };
export type StackedDay = { date: string; total: number; stacks: Stack[] };

/**
 * One bar per day, stacked by the top `top` features over the range plus
 * "other". Missing days are zero. Series order follows the range totals, so
 * a feature keeps its shade across every bar.
 */
export function stackDays(u: BillingUsage, range: { from: string; to: string }, top = 3): { series: (AIFeature | "other")[]; days: StackedDay[] } {
  const ranked = [...u.by_feature].filter((f) => f.credits > 0).sort((a, b) => b.credits - a.credits);
  const head = ranked.slice(0, top).map((f) => f.feature);
  const hasOther = ranked.length > top;
  const series: (AIFeature | "other")[] = hasOther ? [...head, "other"] : head;
  const byDate = new Map(u.by_day.map((d) => [d.date, d]));
  const days = daysBetween(range.from.slice(0, 10), range.to.slice(0, 10)).map((date) => {
    const d = byDate.get(date);
    const total = d?.credits ?? 0;
    const per = d?.by_feature ?? {};
    const stacks: Stack[] = head.map((f) => ({ key: f, credits: per[f] ?? 0 }));
    if (hasOther) {
      const known = stacks.reduce((s, x) => s + x.credits, 0);
      stacks.push({ key: "other", credits: Math.max(0, total - known) });
    } else if (!d?.by_feature && head.length === 1) {
      stacks[0].credits = total;
    }
    return { date, total, stacks };
  });
  return { series, days };
}
