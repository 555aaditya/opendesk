// Test helpers: call the mock API as the browser would and read an SSE answer.

import { db } from "@/mock/db";
import { dispatch as mockDispatch } from "@/mock/router";
import { parseFrame } from "@/lib/api/client";

export function dispatch(method: string, path: string, body?: unknown) {
  const ws = db.workspaces[0]?.workspace.id;
  return mockDispatch(`http://mock${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { Accept: "text/event-stream", ...(ws ? { "OD-Workspace": ws } : {}) },
  });
}

export async function parseSse(r: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await r.text();
  return text
    .split(/\n\n/)
    .map((f) => parseFrame(f))
    .filter((x): x is { event: string; data: string } => !!x)
    .map((f) => ({ event: f.event, data: JSON.parse(f.data) as unknown }));
}
