// The English catalogs, bundled. Add a namespace here, in NAMESPACES, and as
// locales/en/<ns>.json; i18next.d.ts derives the typed keys from this object.

import ai from "./locales/en/ai.json";
import aiTicket from "./locales/en/aiTicket.json";
import billing from "./locales/en/billing.json";
import common from "./locales/en/common.json";
import inbox from "./locales/en/inbox.json";
import contacts from "./locales/en/contacts.json";
import kb from "./locales/en/kb.json";
import pub from "./locales/en/public.json";
import reports from "./locales/en/reports.json";
import settings from "./locales/en/settings.json";
import settingsChannels from "./locales/en/settingsChannels.json";
import settingsDev from "./locales/en/settingsDev.json";
import settingsInbox from "./locales/en/settingsInbox.json";
import shell from "./locales/en/shell.json";

export const en = { common, billing, ai, aiTicket, public: pub, shell, settings, settingsInbox, settingsDev, settingsChannels, contacts, kb, reports, inbox } as const;
export const NAMESPACES = ["common", "billing", "ai", "aiTicket", "public", "shell", "settings", "settingsInbox", "settingsDev", "settingsChannels", "contacts", "kb", "reports", "inbox"] as const;
export type Namespace = (typeof NAMESPACES)[number];
