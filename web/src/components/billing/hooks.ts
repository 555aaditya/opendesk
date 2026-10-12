import { useMutation, useQuery } from "@tanstack/react-query";
import { intlLocale } from "@/i18n";
import { credits } from "@/lib/format";
import { api } from "@/lib/api/endpoints";
import { q } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { toast } from "@/components/ui/toast";
import { limitState, type LimitKind } from "./model";

export function useBilling() {
  return useQuery(q.billing());
}

/** Owners and admins manage billing; everyone else reads. */
export function useCanManageBilling() {
  return atLeast(useRole(), "admin");
}

export function useLimit(kind: LimitKind) {
  // Counts move with every invite and mailbox, so don't trust an old copy here.
  const { data } = useQuery({ ...q.billing(), staleTime: 5_000 });
  return { billing: data, ...limitState(data, kind) };
}

/** Leaves for a Stripe-hosted page. Stays "pending" through the navigation. */
function useRedirect<A>(fn: (a: A) => Promise<{ url: string }>) {
  return useMutation({
    mutationFn: async (a: A) => {
      const { url } = await fn(a);
      location.assign(url);
      // Keep the button busy while the browser leaves.
      await new Promise(() => {});
    },
    onError: (e) => toast.error(e),
  });
}

export const useCheckout = () => useRedirect((interval: "month" | "year") => api.billing.checkout(interval));
export const usePortal = () => useRedirect((_: void) => api.billing.portal());
export const useBuyCredits = () => useRedirect((packs: number) => api.billing.creditsCheckout(packs));

/** Locale-aware number and date formatting for billing figures. */
export function useFmt() {
  const locale = intlLocale();
  const nf = new Intl.NumberFormat(locale);
  const thisYear = new Date().getFullYear();
  return {
    locale,
    num: (n: number) => nf.format(n),
    /** Credits are decimals (metered to 0.001): 1,234.5, 0.42. */
    credits,
    date: (iso: string | null | undefined) => {
      if (!iso) return "";
      const d = new Date(iso);
      return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(d.getFullYear() !== thisYear ? { year: "numeric" } : {}) }).format(d);
    },
    day: (ymd: string, weekday = false) =>
      new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC", ...(weekday ? { weekday: "short" } : {}) }).format(new Date(`${ymd}T00:00:00Z`)),
  };
}
