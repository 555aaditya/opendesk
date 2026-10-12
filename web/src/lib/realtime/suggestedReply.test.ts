import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Message, SuggestedReply } from "../api/types";
import { qk } from "../queries";
import { env } from "../test/fixtures";
import { applyEnvelope } from "./apply";

const suggestion = (over: Partial<SuggestedReply> = {}): SuggestedReply => ({
  id: "s1",
  ticket_id: "t1",
  message_id: "m1",
  body_html: "<p>Hi Jane</p>",
  sources: [],
  tools: ["search_knowledge"],
  status: "pending",
  reply_id: null,
  created_at: "2026-10-12T10:00:00Z",
  ...over,
});

const message = (id: string): Message => ({ id, ticket_id: "t1", kind: "reply", direction: "inbound", created_at: "2026-10-12T10:05:00Z" }) as Message;

describe("Ollie's suggested reply over realtime", () => {
  it("shows a new suggestion and replaces the previous one", () => {
    const qc = new QueryClient();
    applyEnvelope(qc, env(1, { type: "ai_suggested_reply.created", data: { ticket_id: "t1", suggested_reply: suggestion() } }), { me: "u1" });
    expect(qc.getQueryData<SuggestedReply | null>(qk.suggestedReply("t1"))?.id).toBe("s1");

    applyEnvelope(qc, env(2, { type: "ai_suggested_reply.created", data: { ticket_id: "t1", suggested_reply: suggestion({ id: "s2", message_id: "m2" }) } }), { me: "u1" });
    expect(qc.getQueryData<SuggestedReply | null>(qk.suggestedReply("t1"))?.id).toBe("s2");
  });

  it("clears it when it is sent or discarded, but not for an older one", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.suggestedReply("t1"), suggestion({ id: "s2" }));
    applyEnvelope(qc, env(1, { type: "ai_suggested_reply.updated", data: { ticket_id: "t1", suggested_reply: suggestion({ id: "s1", status: "superseded" }) } }), { me: "u1" });
    expect(qc.getQueryData<SuggestedReply | null>(qk.suggestedReply("t1"))?.id).toBe("s2");

    applyEnvelope(qc, env(2, { type: "ai_suggested_reply.updated", data: { ticket_id: "t1", suggested_reply: suggestion({ id: "s2", status: "discarded" }) } }), { me: "u1" });
    expect(qc.getQueryData(qk.suggestedReply("t1"))).toBeNull();
  });

  it("drops it when a newer reply lands on the ticket", () => {
    const qc = new QueryClient();
    qc.setQueryData(qk.suggestedReply("t1"), suggestion());
    applyEnvelope(qc, env(1, { type: "message.updated", data: { ticket_id: "t1", message: message("m1") } }), { me: "u1" });
    expect(qc.getQueryData<SuggestedReply | null>(qk.suggestedReply("t1"))?.id).toBe("s1");

    applyEnvelope(qc, env(2, { type: "message.created", data: { ticket_id: "t1", message: message("m9") } }), { me: "u1" });
    expect(qc.getQueryData(qk.suggestedReply("t1"))).toBeNull();
  });
});
