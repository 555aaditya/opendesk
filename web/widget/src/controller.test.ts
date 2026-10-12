import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controller } from "./controller";
import { createMock, demoConfig } from "./mock";
import { repliesFor } from "./live";

describe("controller with the agent", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("streams a reply, swaps in the posted message, confirms the action and rates it", async () => {
    const mock = createMock({ seed: "preview", latency: 5 });
    const c = new Controller({ base: "https://mock.invalid", key: "wk_demo", fetcher: mock.fetch, socketFactory: mock.socket, persist: false });
    const boot = c.boot(demoConfig("wk_demo"));
    await vi.advanceTimersByTimeAsync(200);
    await boot;
    const id = mock.showcaseId;
    const open = c.openConversation(id);
    await vi.advanceTimersByTimeAsync(50);
    await open;
    const before = c.store.get().messages[id].length;

    mock.playShowcase();
    await vi.advanceTimersByTimeAsync(1500);
    const writing = repliesFor(c.store.get().live, id);
    expect(writing).toHaveLength(1);
    expect(writing[0].tools[0]).toMatchObject({ name: "Order lookup" });

    await vi.advanceTimersByTimeAsync(8000);
    const s = c.store.get();
    expect(repliesFor(s.live, id)).toHaveLength(0);
    const msgs = s.messages[id];
    expect(msgs).toHaveLength(before + 1);
    const reply = msgs[msgs.length - 1];
    expect(reply.ai).toBe(true);
    expect(reply.ai_action?.status).toBe("pending");
    expect(s.swapped[reply.id]).toBe(true);

    // Confirm: busy at once, confirmed optimistically, then the server's message.updated.
    const decide = c.decide(id, reply.ai_action!, "confirm");
    expect(c.store.get().actions[reply.ai_action!.id]).toEqual({ busy: "confirm" });
    await vi.advanceTimersByTimeAsync(20);
    await decide;
    expect(c.store.get().actions[reply.ai_action!.id]).toEqual({ status: "confirmed" });
    await vi.advanceTimersByTimeAsync(400);
    const updated = c.store.get().messages[id].find((m) => m.id === reply.id)!;
    expect(updated.ai_action?.status).toBe("confirmed");
    expect(c.store.get().actions[reply.ai_action!.id]).toBeUndefined();

    // Rate up, then the same again clears it.
    const rate = c.rate(id, updated, "up");
    expect(c.store.get().ratings[reply.id]).toBe("up");
    await vi.advanceTimersByTimeAsync(300);
    await rate;
    expect(c.store.get().messages[id].find((m) => m.id === reply.id)?.ai_rating).toBe("up");
    expect(reply.id in c.store.get().ratings).toBe(false);
    const fresh = c.store.get().messages[id].find((m) => m.id === reply.id)!;
    const clear = c.rate(id, fresh, "up");
    expect(c.store.get().ratings[reply.id]).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    await clear;
    expect(c.store.get().messages[id].find((m) => m.id === reply.id)?.ai_rating).toBeNull();

    c.stop();
    mock.dispose();
  });

  it("marks a handoff from the agent's ended event", async () => {
    const mock = createMock({ seed: "demo", latency: 5 });
    const c = new Controller({ base: "https://mock.invalid", key: "wk_demo", fetcher: mock.fetch, socketFactory: mock.socket, persist: false });
    const boot = c.boot(demoConfig("wk_demo"));
    await vi.advanceTimersByTimeAsync(200);
    await boot;
    c.newConversation();
    const send = c.send("Can I talk to a person?", []);
    await vi.advanceTimersByTimeAsync(50);
    await send;
    const id = c.store.get().active!;
    expect(c.store.get().awaiting[id]).toBeDefined();
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.store.get().handoff[id]).toBe("done");
    expect(c.store.get().conversations?.find((x) => x.id === id)?.ai_handoff).toBe(true);
    c.stop();
    mock.dispose();
  });
});
