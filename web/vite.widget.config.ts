import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The embeddable chat widget: one self-contained IIFE at dist/widget/v1.js.
// Built after the app (the app build empties dist/), so it never clears it.
//
// Dev demo with the in-memory backend:
//   npx vite --config vite.widget.config.ts   ->  http://localhost:5185/widget/demo.html
// The mock is compiled in only for the dev server or WIDGET_MOCK=1 builds.

const LOCALES = path.resolve(import.meta.dirname, "widget/src/locales");

/**
 * English is inline in v1.js; every other language ships as
 * dist/widget/i18n/<lng>.js, a tiny script the widget loads on demand. A
 * script (not JSON over fetch) because embedding sites already allow the
 * widget's origin in script-src.
 */
function widgetCatalogs(): Plugin {
  return {
    name: "opendesk-widget-catalogs",
    apply: "build",
    generateBundle() {
      for (const file of readdirSync(LOCALES).filter((f) => f.endsWith(".json"))) {
        const lng = file.replace(/\.json$/, "");
        const dict = JSON.stringify(JSON.parse(readFileSync(path.join(LOCALES, file), "utf8")));
        this.emitFile({
          type: "asset",
          fileName: `i18n/${lng}.js`,
          source: `(self.__opendeskI18n=self.__opendeskI18n||{})[${JSON.stringify(lng)}]=${dict};\n`,
        });
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [preact(), widgetCatalogs()],
  publicDir: false,
  define: {
    __OD_WIDGET_MOCK__: JSON.stringify(command === "serve" || process.env.WIDGET_MOCK === "1"),
  },
  server: { port: 5185, strictPort: true },
  // The dev server shares web/ with the app; only scan the widget.
  optimizeDeps: { entries: ["widget/demo.html"] },
  build: {
    outDir: "dist/widget",
    emptyOutDir: false,
    target: "es2019",
    cssCodeSplit: false,
    sourcemap: false,
    minify: true,
    lib: {
      entry: "widget/src/main.tsx",
      name: "opendeskWidget",
      formats: ["iife"],
      fileName: () => "v1.js",
    },
  },
}));
