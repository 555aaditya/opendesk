import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Ticket } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { useNow } from "@/lib/useNow";
import { chatWait, useAgentOn, type ChatWait } from "./waiting";

// Live chat visitors waiting with nobody on it, for the whole app: the sidebar, the
// alerts and the tab title read the same list, longest wait first.

const QUERY = { status: ["open", "pending"], assignee: "none", channel: "chat" } as const;

export type UrgentChat = { ticket: Ticket; wait: ChatWait };

export function useUrgentChats(enabled = true) {
  const agentOn = useAgentOn();
  const list = useInfiniteQuery({ ...q.tickets({ ...QUERY, status: [...QUERY.status] }), enabled });
  const tickets = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const now = useNow(tickets.length > 0);
  const urgent = useMemo(
    () =>
      tickets
        .filter((x) => !x.assignee)
        .map((x) => ({ ticket: x, wait: chatWait(x, agentOn, now) }))
        .filter((x): x is UrgentChat => x.wait?.state === "urgent")
        .sort((a, b) => a.wait.since - b.wait.since),
    [tickets, agentOn, now],
  );
  return { urgent, now, ready: list.isSuccess };
}
