// One shared upgrade prompt for every 402 plan_limit / no_credits answer
// (contracts/billing.md). The API client announces them (onPlanLimit); the
// dialog (components/billing/UpgradeDialog) reads this store.

import { create } from "zustand";
import { onPlanLimit, type ApiError } from "./api/client";

export type UpgradeReason = { code: "plan_limit" | "no_credits"; detail: string };

type UpgradeState = { reason: UpgradeReason | null };

export const useUpgrade = create<UpgradeState>(() => ({ reason: null }));

export const upgrade = {
  show(reason: UpgradeReason) {
    useUpgrade.setState({ reason });
  },
  close() {
    useUpgrade.setState({ reason: null });
  },
};

let wired = false;
/** Call once from the app shell. Idempotent. */
export function wireUpgradePrompts() {
  if (wired) return;
  wired = true;
  onPlanLimit((e: ApiError) => upgrade.show({ code: e.code === "no_credits" ? "no_credits" : "plan_limit", detail: e.detail }));
}
