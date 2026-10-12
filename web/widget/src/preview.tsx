/** @jsxImportSource preact */
// A live, interactive preview of the real widget for the dashboard's widget
// settings. It renders the same UI into a shadow root inside `host`, contained
// by it (a transformed wrapper is the containing block of the widget's fixed
// launcher and panel), talks to the in-memory mock backend, and follows config
// changes without remounting.
//
//   const p = mountPreview(el, { config, scene: "chat", dark });
//   p.update({ config: next });   // live, no flash
//   p.destroy();

import { render } from "preact";
import { applyHostVars } from "./config";
import { Controller } from "./controller";
import { createMock } from "./mock";
import { Store } from "./store";
import { css } from "./styles";
import type { WidgetConfig } from "./types";
import { App } from "./ui";

export type PreviewScene = "launcher" | "home" | "chat";
export type PreviewOptions = { config: WidgetConfig; scene: PreviewScene; dark?: boolean };
export type PreviewHandle = { update(opts: Partial<PreviewOptions>): void; destroy(): void };
export type { WidgetConfig };

export function mountPreview(host: HTMLElement, opts: PreviewOptions): PreviewHandle {
  let cur: PreviewOptions = { ...opts };
  let alive = true;

  const wrap = document.createElement("div");
  wrap.setAttribute("data-opendesk-preview", "");
  // transform + contain make this box the containing block for position: fixed inside it.
  wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;transform:translateZ(0);contain:layout paint;border-radius:inherit;";
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.appendChild(wrap);
  const shadow = wrap.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
  const mount = document.createElement("div");
  shadow.appendChild(mount);

  const mock = createMock({ seed: "preview", latency: 60 });
  const store = new Store({ preview: true, dark: opts.dark ?? null });
  const c = new Controller({ base: "https://preview.invalid", key: "wk_preview", fetcher: mock.fetch, socketFactory: mock.socket, persist: false, store });

  const applyConfig = (config: WidgetConfig) => {
    c.setConfig(config);
    const resolved = store.get().config;
    if (resolved) applyHostVars(wrap, resolved);
  };

  let ready = false;
  const applyScene = (scene: PreviewScene) => {
    if (scene === "launcher") {
      store.set({ open: false });
      return;
    }
    if (scene === "home") {
      store.set({ open: true, view: "home", active: null });
      return;
    }
    store.set({ open: true, view: "thread", active: mock.showcaseId });
    if (!ready) return; // boot opens it once the session is up
    void c.openConversation(mock.showcaseId).then(() => alive && mock.playShowcase());
  };

  applyConfig(cur.config);
  applyScene(cur.scene);
  render(<App c={c} />, mount);
  void c.boot(cur.config).then(() => {
    if (!alive) return;
    ready = true;
    applyConfig(cur.config); // a config update may have landed while booting
    applyScene(cur.scene);
  });

  return {
    update(next) {
      if (!alive) return;
      const prev = cur;
      cur = { ...cur, ...Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) };
      if (next.config && next.config !== prev.config) applyConfig(next.config);
      if ("dark" in next) store.set({ dark: next.dark ?? null });
      if (next.scene && next.scene !== prev.scene) applyScene(next.scene);
    },
    destroy() {
      if (!alive) return;
      alive = false;
      render(null, mount);
      c.stop();
      mock.dispose();
      wrap.remove();
    },
  };
}
