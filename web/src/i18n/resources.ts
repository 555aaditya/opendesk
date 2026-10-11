// The English catalogs, bundled. Add a namespace here, in NAMESPACES, and as
// locales/en/<ns>.json; i18next.d.ts derives the typed keys from this object.

import ai from "./locales/en/ai.json";
import aiTicket from "./locales/en/aiTicket.json";
import billing from "./locales/en/billing.json";
import common from "./locales/en/common.json";
import pub from "./locales/en/public.json";

export const en = { common, billing, ai, aiTicket, public: pub } as const;
export const NAMESPACES = ["common", "billing", "ai", "aiTicket", "public"] as const;
export type Namespace = (typeof NAMESPACES)[number];
