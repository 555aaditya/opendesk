import { describe, expect, it, vi } from "vitest";
import type { Envelope, EventsPage } from "../api/types";
import { env } from "../test/fixtures";
import { SeqSync } from "./seq";

function setup(pages: (EventsPage | Error)[] = []) {
  const applied: number[] = [];
  const fetchSince = vi.fn(async (_since: number) => {
    const p = pages.shift();
    if (!p) return { data: [], latest_seq: 0, resync: false };
    if (p instanceof Error) throw p;
    return p;
  });
  const resync = vi.fn();
  const s = new SeqSync({ fetchSince, apply: (e: Envelope) => applied.push(e.seq), resync });
  return { s, applied, fetchSince, resync };
}

describe("SeqSync", () => {
  it("applies contiguous events and ignores duplicates", () => {
    const { s, applied, fetchSince } = setup();
    s.baseline(10);
    s.receive(env(11));
    s.receive(env(12));
    s.receive(env(12));
    s.receive(env(9));
    expect(applied).toEqual([11, 12]);
    expect(s.last).toBe(12);
    expect(fetchSince).not.toHaveBeenCalled();
  });

  it("fills a gap from the events API before applying the buffered event", async () => {
    const { s, applied, fetchSince } = setup([{ data: [env(12), env(11)], latest_seq: 13, resync: false }]);
    s.baseline(10);
    s.receive(env(13));
    await s.catchUp();
    expect(fetchSince).toHaveBeenCalledWith(10);
    expect(applied).toEqual([11, 12, 13]);
    expect(s.last).toBe(13);
  });

  it("buffers events that arrive while catching up", async () => {
    let release!: (p: EventsPage) => void;
    const applied: number[] = [];
    const s = new SeqSync({
      fetchSince: () => new Promise((r) => (release = r)),
      apply: (e) => applied.push(e.seq),
      resync: vi.fn(),
    });
    s.baseline(1);
    s.receive(env(4));
    s.receive(env(5));
    const done = s.catchUp();
    release({ data: [env(2), env(3)], latest_seq: 3, resync: false });
    await done;
    expect(applied).toEqual([2, 3, 4, 5]);
  });

  it("pages until it reaches latest_seq", async () => {
    const { s, applied, fetchSince } = setup([
      { data: [env(2), env(3)], latest_seq: 5, resync: false },
      { data: [env(4), env(5)], latest_seq: 5, resync: false },
    ]);
    s.baseline(1);
    await s.catchUp();
    expect(fetchSince.mock.calls.map((c) => c[0])).toEqual([1, 3]);
    expect(applied).toEqual([2, 3, 4, 5]);
  });

  it("resyncs when the gap is past retention", async () => {
    const { s, applied, resync } = setup([{ data: [], latest_seq: 500, resync: true }]);
    s.baseline(1);
    await s.catchUp();
    expect(resync).toHaveBeenCalledOnce();
    expect(applied).toEqual([]);
    expect(s.last).toBe(500);
    s.receive(env(501));
    expect(applied).toEqual([501]);
  });

  it("resyncs when the events API is unreachable", async () => {
    const { s, resync } = setup([new Error("offline")]);
    s.baseline(1);
    await s.catchUp();
    expect(resync).toHaveBeenCalledOnce();
  });

  it("shares one catch-up between concurrent callers", async () => {
    const { s, fetchSince } = setup([{ data: [env(2)], latest_seq: 2, resync: false }]);
    s.baseline(1);
    await Promise.all([s.catchUp(), s.catchUp()]);
    expect(fetchSince).toHaveBeenCalledOnce();
  });

  it("dedupes by envelope id", () => {
    const { s, applied } = setup();
    s.markSeen("evt_2");
    s.baseline(1);
    s.receive(env(2));
    s.receive(env(3));
    expect(applied).toEqual([3]);
    expect(s.last).toBe(3);
  });
});
