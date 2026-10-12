// The route table. Every page is a lazy chunk preloaded on link intent, carries
// its tab title in staticData.title, and prefetches its first queries in its
// loader through the same queryOptions its components read.

import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { RootLayout } from "./app/RootLayout";
import { AppLayout } from "./app/AppLayout";
import { AuthLayout } from "./app/AuthLayout";
import { NotFound, RouteError, RoutePending } from "./app/RouteStates";
import { bootSession } from "./lib/session";
import { queryClient } from "./lib/queryClient";
import { q } from "./lib/queries";
import { folderById, listQuery, parseInboxSearch } from "./lib/folders";

export type RouterContext = { queryClient: QueryClient };

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /** Tab title, without the brand. */
    title?: string;
  }
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => lazyRouteComponent(load);

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// ─── Guards ────────────────────────────────────────────────────────────────

async function requireAuth(href: string) {
  const s = await bootSession();
  if (s.status !== "authed") throw redirect({ to: "/login", search: { next: href } });
  return s;
}

async function requireWorkspace(href: string) {
  const s = await requireAuth(href);
  if (!s.workspaceId) throw redirect({ to: "/onboarding" });
  return s;
}

async function guestOnly() {
  const s = await bootSession();
  if (s.status === "authed") throw redirect({ to: "/" });
}

// ─── Root ──────────────────────────────────────────────────────────────────

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

// ─── Public (no app chrome) ────────────────────────────────────────────────

const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/help/$slug",
  component: page(() => import("./pages/public/help/HelpLayout")),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.publicHelp(params.slug)),
  staticData: { title: "Help center" },
});
const helpHomeRoute = createRoute({
  getParentRoute: () => helpRoute,
  path: "/",
  component: page(() => import("./pages/public/help/HelpHome")),
});
const helpCollectionRoute = createRoute({
  getParentRoute: () => helpRoute,
  path: "/c/$collection",
  component: page(() => import("./pages/public/help/HelpCollection")),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.publicCollection(params.slug, params.collection)),
});
const helpArticleRoute = createRoute({
  getParentRoute: () => helpRoute,
  path: "/a/$article",
  component: page(() => import("./pages/public/help/HelpArticle")),
  loader: ({ context, params }) => context.queryClient.ensureQueryData(q.publicArticle(params.slug, params.article)),
});
const helpSearchRoute = createRoute({
  getParentRoute: () => helpRoute,
  path: "/search",
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: str(s.q) }),
  component: page(() => import("./pages/public/help/HelpSearch")),
  staticData: { title: "Search" },
});

const csatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/csat/$token",
  validateSearch: (s: Record<string, unknown>): { score?: string } => ({ score: typeof s.score === "number" ? String(s.score) : str(s.score) }),
  component: page(() => import("./pages/public/Csat")),
  staticData: { title: "Rate your conversation" },
});

// ─── Auth ──────────────────────────────────────────────────────────────────

const authLayout = createRoute({ getParentRoute: () => rootRoute, id: "auth", component: AuthLayout });

const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/login",
  validateSearch: (s: Record<string, unknown>): { next?: string; error?: string } => ({ next: str(s.next), error: str(s.error) }),
  beforeLoad: guestOnly,
  loader: ({ context }) => context.queryClient.prefetchQuery(q.authConfig()),
  component: page(() => import("./pages/auth/Login")),
  staticData: { title: "Log in" },
});
const registerRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/register",
  validateSearch: (s: Record<string, unknown>): { next?: string; email?: string } => ({ next: str(s.next), email: str(s.email) }),
  beforeLoad: guestOnly,
  loader: ({ context }) => context.queryClient.prefetchQuery(q.authConfig()),
  component: page(() => import("./pages/auth/Register")),
  staticData: { title: "Create your account" },
});
const forgotRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/forgot",
  component: page(() => import("./pages/auth/Forgot")),
  loader: ({ context }) => context.queryClient.prefetchQuery(q.authConfig()),
  staticData: { title: "Reset your password" },
});
const resetRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/reset",
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({ token: str(s.token) }),
  component: page(() => import("./pages/auth/Reset")),
  staticData: { title: "Choose a new password" },
});
const verifyRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/verify",
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({ token: str(s.token) }),
  component: page(() => import("./pages/auth/Verify")),
  staticData: { title: "Verify your email" },
});
const callbackRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/auth/callback",
  validateSearch: (s: Record<string, unknown>): { code?: string; error?: string; next?: string } => ({ code: str(s.code), error: str(s.error), next: str(s.next) }),
  component: page(() => import("./pages/auth/Callback")),
  staticData: { title: "Signing in" },
});
const inviteRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/invite",
  validateSearch: (s: Record<string, unknown>): { token?: string } => ({ token: str(s.token) }),
  component: page(() => import("./pages/auth/Invite")),
  staticData: { title: "Join workspace" },
});

// The MCP OAuth consent page: an AI client asks to connect; signing in is required.
const oauthConsentRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/oauth/consent",
  validateSearch: (s: Record<string, unknown>): { request?: string; error?: string } => ({ request: str(s.request), error: str(s.error) }),
  beforeLoad: ({ location }) => requireAuth(location.href),
  loaderDeps: ({ search }) => ({ request: search.request }),
  loader: ({ context, deps }) => {
    if (deps.request && /^[0-9a-f-]{36}$/i.test(deps.request)) void context.queryClient.prefetchQuery(q.oauthRequest(deps.request));
  },
  component: page(() => import("./pages/auth/OAuthConsent")),
  staticData: { title: "Connect an app" },
});

const onboardingRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/onboarding",
  beforeLoad: ({ location }) => requireAuth(location.href),
  component: page(() => import("./pages/onboarding/Workspace")),
  staticData: { title: "Create a workspace" },
});
const onboardingMailboxRoute = createRoute({
  getParentRoute: () => authLayout,
  path: "/onboarding/mailbox",
  beforeLoad: ({ location }) => requireWorkspace(location.href),
  component: page(() => import("./pages/onboarding/Mailbox")),
  staticData: { title: "Connect a mailbox" },
});

// ─── App ───────────────────────────────────────────────────────────────────

const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: ({ location }) => requireWorkspace(location.href),
  loader: ({ context }) => {
    // The shell's own data: counts and views for the sidebar, members/tags/teams
    // for pickers everywhere. Started together, awaited for the sidebar only.
    const qc = context.queryClient;
    void qc.prefetchQuery(q.members());
    void qc.prefetchQuery(q.tags());
    void qc.prefetchQuery(q.teams());
    void qc.prefetchQuery(q.notifications());
    return Promise.all([qc.ensureQueryData(q.counts()), qc.ensureQueryData(q.views())]);
  },
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
  },
});

const inboxRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/inbox/$folder/{-$ticketId}",
  validateSearch: parseInboxSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) => {
    const f = folderById(params.folder);
    if (!f) throw redirect({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
    const qc = context.queryClient;
    if (params.ticketId) prefetchTicket(qc, params.ticketId);
    return qc.ensureInfiniteQueryData(q.tickets(listQuery(f.query, deps)));
  },
  component: page(() => import("./pages/inbox/InboxPage")),
  staticData: { title: "Inbox" },
});

const viewRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/views/$viewId/{-$ticketId}",
  validateSearch: parseInboxSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) => {
    const qc = context.queryClient;
    if (params.ticketId) prefetchTicket(qc, params.ticketId);
    return qc.ensureInfiniteQueryData(q.tickets(listQuery({ view_id: params.viewId }, deps)));
  },
  component: page(() => import("./pages/inbox/InboxPage")),
  staticData: { title: "View" },
});

function prefetchTicket(qc: QueryClient, id: string) {
  void qc.prefetchQuery(q.ticket(id));
  // A ticket number in the URL resolves through the ticket; messages need the uuid.
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    void qc.prefetchQuery(q.messages(id));
    void qc.prefetchQuery(q.activities(id));
  }
  void qc.prefetchQuery(q.savedReplies());
  void qc.prefetchQuery(q.slaPolicies());
}

const contactsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/contacts/{-$contactId}",
  validateSearch: (s: Record<string, unknown>): { q?: string; company?: string } => ({ q: str(s.q), company: str(s.company) }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) => {
    if (params.contactId) {
      void context.queryClient.prefetchQuery(q.contact(params.contactId));
      void context.queryClient.prefetchQuery(q.contactTickets(params.contactId));
    }
    return context.queryClient.ensureInfiniteQueryData(q.contacts({ q: deps.q, company_id: deps.company }));
  },
  component: page(() => import("./pages/contacts/ContactsPage")),
  staticData: { title: "Contacts" },
});

const companiesRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/companies/{-$companyId}",
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({ q: str(s.q) }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, params, deps }) => {
    if (params.companyId) {
      void context.queryClient.prefetchQuery(q.company(params.companyId));
      void context.queryClient.prefetchInfiniteQuery(q.contacts({ company_id: params.companyId }));
    }
    return context.queryClient.ensureInfiniteQueryData(q.companies({ q: deps.q }));
  },
  component: page(() => import("./pages/contacts/CompaniesPage")),
  staticData: { title: "Companies" },
});

const kbRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/kb",
  validateSearch: (s: Record<string, unknown>): { collection?: string; status?: "draft" | "published"; q?: string } => ({
    collection: str(s.collection),
    status: s.status === "draft" || s.status === "published" ? (s.status as "draft" | "published") : undefined,
    q: str(s.q),
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(q.kbCollections()),
      context.queryClient.ensureQueryData(q.kbArticles({ collection_id: deps.collection, status: deps.status, q: deps.q })),
    ]),
  component: page(() => import("./pages/kb/KbPage")),
  staticData: { title: "Knowledge base" },
});

const kbArticleRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/kb/articles/$articleId",
  // `title` prefills a new article (the agent report's "Write an article").
  validateSearch: (s: Record<string, unknown>): { collection?: string; title?: string } => ({ collection: str(s.collection), title: str(s.title)?.slice(0, 200) }),
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(q.kbCollections());
    if (params.articleId !== "new") return context.queryClient.ensureQueryData(q.kbArticle(params.articleId));
  },
  component: page(() => import("./pages/kb/ArticleEditor")),
  staticData: { title: "Article" },
});

export function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The reports range from the URL, or the last 30 days. */
export function reportsRange(s: { from?: string; to?: string }) {
  const d = defaultRange();
  return { from: s.from ?? d.from, to: s.to ?? d.to };
}

const reportsRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/reports",
  validateSearch: (s: Record<string, unknown>): { from?: string; to?: string } => ({
    from: isDay(s.from) ? s.from : undefined,
    to: isDay(s.to) ? s.to : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(q.reports(reportsRange(deps))),
  component: page(() => import("./pages/reports/ReportsPage")),
  staticData: { title: "Reports" },
});

// ─── Settings ──────────────────────────────────────────────────────────────

const settingsLayout = createRoute({
  getParentRoute: () => appLayout,
  path: "/settings",
  component: page(() => import("./pages/settings/SettingsLayout")),
  staticData: { title: "Settings" },
});

const settingsIndex = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile" });
  },
});

type Prefetch = (qc: QueryClient) => unknown;
function settingsPage<P extends string>(path: P, title: string, load: () => Promise<{ default: React.ComponentType }>, prefetch?: Prefetch) {
  return createRoute({
    getParentRoute: () => settingsLayout,
    path,
    loader: prefetch ? ({ context }) => prefetch(context.queryClient) : undefined,
    component: page(load),
    staticData: { title },
  });
}

const sProfile = settingsPage("/profile", "Profile", () => import("./pages/settings/Profile"));
const sSecurity = settingsPage("/security", "Security", () => import("./pages/settings/Security"), (qc) => qc.ensureQueryData(q.sessions()));
const sWorkspace = settingsPage("/workspace", "Workspace", () => import("./pages/settings/WorkspaceSettings"), (qc) =>
  Promise.all([qc.ensureQueryData(q.workspace()), qc.ensureQueryData(q.members())]),
);
const sMembers = settingsPage("/members", "Members", () => import("./pages/settings/Members"), (qc) =>
  Promise.all([qc.ensureQueryData(q.members()), qc.ensureQueryData(q.invitations())]),
);
const sTeams = settingsPage("/teams", "Teams", () => import("./pages/settings/Teams"), (qc) =>
  Promise.all([qc.ensureQueryData(q.teams()), qc.ensureQueryData(q.members())]),
);
const sMailboxes = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/mailboxes",
  validateSearch: (s: Record<string, unknown>): { connected?: string; error?: string } => ({ connected: str(s.connected), error: str(s.error) }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.mailboxes()),
  component: page(() => import("./pages/settings/Mailboxes")),
  staticData: { title: "Mailboxes" },
});
const sMailboxNew = settingsPage("/mailboxes/new", "Add a mailbox", () => import("./pages/settings/MailboxNew"), (qc) => qc.prefetchQuery(q.teams()));
const sMailboxDetail = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/mailboxes/$mailboxId",
  loader: ({ context }) => context.queryClient.ensureQueryData(q.mailboxes()),
  component: page(() => import("./pages/settings/MailboxDetail")),
  staticData: { title: "Mailbox" },
});
const sTags = settingsPage("/tags", "Labels", () => import("./pages/settings/Tags"), (qc) => qc.ensureQueryData(q.tags()));
const sCustomFields = settingsPage("/custom-fields", "Custom fields", () => import("./pages/settings/CustomFields"));
const sAssignment = settingsPage("/assignment", "Assignment", () => import("./pages/settings/Assignment"), (qc) =>
  Promise.all([qc.ensureQueryData(q.assignment()), qc.ensureQueryData(q.members())]),
);
const sTriage = settingsPage("/triage", "Triage", () => import("./pages/settings/Triage"), (qc) => qc.ensureQueryData(q.triage()));
const sBusinessHours = settingsPage("/business-hours", "Business hours", () => import("./pages/settings/BusinessHours"), (qc) =>
  qc.ensureQueryData(q.businessHours()),
);
const sSavedReplies = settingsPage("/saved-replies", "Saved replies", () => import("./pages/settings/SavedReplies"), (qc) =>
  qc.ensureQueryData(q.savedReplies()),
);
const sViews = settingsPage("/views", "Views", () => import("./pages/settings/Views"), (qc) => qc.ensureQueryData(q.views()));
const sSla = settingsPage("/sla", "SLA policies", () => import("./pages/settings/Sla"), (qc) => qc.ensureQueryData(q.slaPolicies()));
const sAutomations = settingsPage("/automations", "Automations", () => import("./pages/settings/Automations"), (qc) =>
  qc.ensureQueryData(q.automations()),
);
const sAutomationEdit = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/automations/$automationId",
  loader: ({ context }) => {
    const qc = context.queryClient;
    void qc.prefetchQuery(q.mailboxes());
    void qc.prefetchQuery(q.teams());
    return qc.ensureQueryData(q.automations());
  },
  component: page(() => import("./pages/settings/AutomationEdit")),
  staticData: { title: "Automation" },
});
const sWidget = settingsPage("/widget", "Chat widget", () => import("./pages/settings/WidgetSettings"), (qc) => {
  void qc.prefetchQuery(q.members());
  void qc.prefetchQuery(q.aiConfig());
  return Promise.all([qc.ensureQueryData(q.widgetSettings()), qc.ensureQueryData(q.workspace())]);
});
const sApiKeys = settingsPage("/api-keys", "API keys", () => import("./pages/settings/ApiKeys"), (qc) => qc.ensureQueryData(q.apiKeys()));
// Connecting AI clients to opendesk's MCP server (contracts/agent.md "opendesk MCP server").
const sAiClients = settingsPage("/ai-clients", "AI clients", () => import("./pages/settings/AiClients"), (qc) =>
  Promise.all([qc.ensureQueryData(q.aiClientServer()), qc.ensureQueryData(q.aiClientConnections())]),
);
const sWebhooks = settingsPage("/webhooks", "Webhooks", () => import("./pages/settings/Webhooks"), (qc) => qc.ensureQueryData(q.webhooks()));
const sWebhookDetail = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/webhooks/$webhookId",
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(q.webhooks()),
      context.queryClient.ensureQueryData(q.webhookDeliveries(params.webhookId)),
    ]),
  component: page(() => import("./pages/settings/WebhookDetail")),
  staticData: { title: "Webhook" },
});
const sAudit = settingsPage("/audit-log", "Audit log", () => import("./pages/settings/AuditLog"), (qc) =>
  qc.ensureInfiniteQueryData(q.auditLogs()),
);

const sBilling = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/billing",
  validateSearch: (s: Record<string, unknown>): { checkout?: string; credits?: string; payment_method?: string } => ({
    checkout: str(s.checkout),
    credits: str(s.credits),
    payment_method: str(s.payment_method),
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.billing()),
  component: page(() => import("./pages/settings/Billing")),
  staticData: { title: "Plan and billing" },
});
const sAi = settingsPage("/ai", "AI", () => import("./pages/settings/AiSettings"), (qc) => {
  void qc.prefetchQuery(q.aiModels());
  return qc.ensureQueryData(q.aiConfig());
});

// The widget AI agent (contracts/agent.md).
const sAgent = settingsPage("/ai/agent", "AI agent", () => import("./pages/settings/agent/AgentOverview"), (qc) => {
  void qc.prefetchQuery(q.aiConfig());
  void qc.prefetchQuery(q.agentSetup());
  void qc.prefetchQuery(q.agentReview());
  return qc.ensureQueryData(q.agentReport(defaultRange()));
});
const sAgentBehaviour = settingsPage("/ai/behaviour", "Agent behaviour", () => import("./pages/settings/agent/AgentBehaviour"), (qc) => {
  void qc.prefetchQuery(q.aiModels());
  void qc.prefetchQuery(q.widgetSettings());
  return Promise.all([qc.ensureQueryData(q.aiConfig()), qc.ensureQueryData(q.workspace())]);
});
const sAgentKnowledge = settingsPage("/ai/knowledge", "Knowledge", () => import("./pages/settings/agent/AgentKnowledge"), (qc) =>
  qc.ensureQueryData(q.knowledge()),
);
const sAgentTools = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/ai/tools",
  validateSearch: (s: Record<string, unknown>): { connected?: string; error?: string } => ({ connected: str(s.connected), error: str(s.error) }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q.mcpServers()),
  component: page(() => import("./pages/settings/agent/AgentTools")),
  staticData: { title: "Agent tools" },
});
const sAgentPlayground = settingsPage("/ai/playground", "Agent playground", () => import("./pages/settings/agent/AgentPlayground"), (qc) => {
  void qc.prefetchQuery(q.aiModels());
  void qc.prefetchQuery(q.widgetSettings());
  return Promise.all([qc.ensureQueryData(q.aiConfig()), qc.ensureQueryData(q.workspace())]);
});
const sAgentTests = settingsPage("/ai/tests", "Agent tests", () => import("./pages/settings/agent/AgentTests"), (qc) => {
  void qc.prefetchQuery(q.agentTestRuns());
  void qc.prefetchQuery(q.mcpServers());
  return Promise.all([qc.ensureQueryData(q.agentTests()), qc.ensureQueryData(q.aiConfig())]);
});
const sIntegrations = createRoute({
  getParentRoute: () => settingsLayout,
  path: "/integrations",
  validateSearch: (s: Record<string, unknown>): { connected?: string; error?: string } => ({ connected: str(s.connected), error: str(s.error) }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(q.integrationCatalog());
    return context.queryClient.ensureQueryData(q.integrations());
  },
  component: page(() => import("./pages/settings/Integrations")),
  staticData: { title: "Integrations" },
});

const routeTree = rootRoute.addChildren([
  helpRoute.addChildren([helpHomeRoute, helpCollectionRoute, helpArticleRoute, helpSearchRoute]),
  csatRoute,
  authLayout.addChildren([
    loginRoute,
    registerRoute,
    forgotRoute,
    resetRoute,
    verifyRoute,
    callbackRoute,
    inviteRoute,
    oauthConsentRoute,
    onboardingRoute,
    onboardingMailboxRoute,
  ]),
  appLayout.addChildren([
    indexRoute,
    inboxRoute,
    viewRoute,
    contactsRoute,
    companiesRoute,
    kbRoute,
    kbArticleRoute,
    reportsRoute,
    settingsLayout.addChildren([
      settingsIndex,
      sProfile,
      sSecurity,
      sWorkspace,
      sMembers,
      sTeams,
      sMailboxes,
      sMailboxNew,
      sMailboxDetail,
      sTags,
      sCustomFields,
      sAssignment,
      sTriage,
      sBusinessHours,
      sSavedReplies,
      sViews,
      sSla,
      sAutomations,
      sAutomationEdit,
      sWidget,
      sApiKeys,
      sAiClients,
      sWebhooks,
      sWebhookDetail,
      sAudit,
      sBilling,
      sAi,
      sAgent,
      sAgentBehaviour,
      sAgentKnowledge,
      sAgentTools,
      sAgentPlayground,
      sAgentTests,
      sIntegrations,
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 200,
  defaultPendingMinMs: 0,
  scrollRestoration: true,
});
