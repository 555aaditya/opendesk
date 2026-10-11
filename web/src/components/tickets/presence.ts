import { useMemo } from "react";
import { useRealtime } from "@/lib/realtime/store";
import { viewers, type Viewer } from "@/lib/realtime/presence";
import { useSession } from "@/lib/session";

const none: Viewer[] = [];

/** Teammates on a ticket right now (never yourself). */
export function useTicketViewers(ticketId: string | undefined): Viewer[] {
  const state = useRealtime((s) => (ticketId ? s.presence[ticketId] : undefined));
  const me = useSession((s) => s.user?.id);
  return useMemo(() => (state ? viewers(state, me) : none), [state, me]);
}
