// The assistant's name, in one place. The server reports the same name as
// `assistant_name` in GET /v1/ai/config; prefer that through useAssistantName().

import { useQuery } from "@tanstack/react-query";
import { q } from "@/lib/queries";

export const ASSISTANT_NAME = "Jev";

export function useAssistantName(): string {
  const { data } = useQuery(q.aiConfig());
  return data?.assistant_name || ASSISTANT_NAME;
}
