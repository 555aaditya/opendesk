// Mock mode (VITE_MOCK=1): an in-memory API and gateway seeded with realistic
// data, so every screen runs without a backend. Only imported behind the
// build-time MOCK flag, so production bundles never include it.

import { setTransport } from "@/lib/api/client";
import { setSocketFactory } from "@/lib/realtime/transport";
import { db } from "./db";
import { paused, publish, socketFactory, sockets } from "./gateway";
import { registerAi } from "./handlers/ai";
import { registerAiTicket } from "./handlers/aiTicket";
import { registerAssistant } from "./handlers/assistant";
import { registerAuth, setSignedIn } from "./handlers/auth";
import { registerBilling } from "./handlers/billing";
import { registerLabels } from "./handlers/labels";
import { registerResources } from "./handlers/resources";
import { registerTickets } from "./handlers/tickets";
import { registerWorkspace } from "./handlers/workspace";
import { pauseLive, resumeLive, startLive } from "./live";
import { dispatch } from "./router";
import { seed } from "./seed";

declare global {
  interface Window {
    __odMock?: {
      db: typeof db;
      emit: (type: string, data: Record<string, unknown>, topics?: string[]) => void;
      pause: () => void;
      resume: () => void;
      dropEvents: (on: boolean) => void;
      reconnect: () => void;
    };
  }
}

let installed = false;

export function installMock(): void {
  if (installed) return;
  installed = true;

  const params = new URLSearchParams(location.search);
  if (params.get("mock") === "anon") setSignedIn(false);

  seed();
  registerAuth();
  registerWorkspace();
  registerTickets();
  registerLabels();
  registerResources();
  registerBilling();
  registerAi();
  registerAiTicket();
  registerAssistant();

  setTransport((input, init) => dispatch(input, init));
  setSocketFactory(socketFactory);

  if (params.get("mock_quiet") !== "1") startLive();

  window.__odMock = {
    db,
    emit: (type, data, topics) => {
      publish(db.workspaces[0], type, data, { topics });
    },
    pause: pauseLive,
    resume: resumeLive,
    dropEvents: (on) => {
      paused.drop = on;
    },
    reconnect: () => sockets.forEach((s) => s.bounce()),
  };
  console.info("[opendesk] mock mode: in-memory API and gateway. window.__odMock has helpers.");
}
