// The MCP OAuth consent page (contracts/agent.md "OAuth"): an AI client asked to
// connect through /oauth/authorize, which sent the browser here. The signed-in user
// sees the client's name, where the browser returns to and what it asks for, picks
// a workspace, and approves or denies. The API answers with the client's redirect
// URI (a code or an error, and state), and the browser goes there.

import { useMutation, useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { Cable, Check, Minus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthHeading } from "@/app/AuthLayout";
import { Notice } from "@/components/auth/parts";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { IconTile } from "@/components/settings2/bits";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import type { OAuthRequest } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { springs } from "@/lib/motion";
import { q } from "@/lib/queries";
import { useSession } from "@/lib/session";

const route = getRouteApi("/auth/oauth/consent");

/** Leaves the app for the client's redirect URI. A seam for tests. */
export const leave = { to: (url: string) => window.location.assign(url) };

// Schemes a browser would run or load as a page; a native app's own scheme is fine.
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:", "mailto:", "tel:", "sms:", "intent:", "chrome:", "view-source:"]);

/** Only http(s) URLs and native app schemes leave the app; the API only answers with registered ones. */
export function safeRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || u.protocol === "http:") return true;
    return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !UNSAFE_SCHEMES.has(u.protocol);
  } catch {
    return false;
  }
}

/** The workspace to preselect: the current one when the user may connect it, else the first. */
export function initialWorkspace(req: Pick<OAuthRequest, "workspaces">, current: string | null): string | undefined {
  return req.workspaces.find((w) => w.id === current)?.id ?? req.workspaces[0]?.id;
}

export default function OAuthConsent(): React.JSX.Element {
  const { t } = useTranslation("aiSetup");
  const { request = "", error } = route.useSearch();
  const valid = /^[0-9a-f-]{36}$/i.test(request);
  const req = useQuery({ ...q.oauthRequest(request), enabled: valid && !error });

  if (error || !valid) return <Ended title={t("consent.invalidTitle")} body={t("consent.invalidBody")} />;
  if (req.isLoading)
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-4 h-24 rounded-md" />
        <Skeleton className="h-10 rounded-md" />
      </div>
    );
  if (req.isError || !req.data) {
    const gone = isApiError(req.error, "request_expired") || isApiError(req.error, "not_found");
    return gone ? <Ended title={t("consent.expiredTitle")} body={t("consent.expiredBody")} /> : <Ended title={t("consent.error")} body={errorMessage(req.error)} />;
  }
  if (!req.data.workspaces.length) return <Ended title={t("consent.noWorkspaceTitle")} body={t("consent.noWorkspaceBody")} />;
  return <ConsentForm req={req.data} />;
}

/** The decision form for a loaded request. */
export function ConsentForm({ req }: { req: OAuthRequest }) {
  const { t } = useTranslation("aiSetup");
  const reduce = useReducedMotion();
  const current = useSession((s) => s.workspaceId);
  const [wid, setWid] = useState(() => initialWorkspace(req, current));
  const [leaving, setLeaving] = useState(false);
  const ws = req.workspaces.find((w) => w.id === wid);
  const granted = new Set(ws?.scopes ?? []);

  const decide = useMutation({
    mutationFn: (approve: boolean) => (approve ? api.oauth.approve(req.id, wid!) : api.oauth.deny(req.id)),
    onSuccess: (d) => {
      if (!safeRedirect(d.redirect_to)) return;
      setLeaving(true);
      leave.to(d.redirect_to);
    },
  });
  const failed = decide.error;
  const gone = isApiError(failed, "request_expired");
  if (gone) return <Ended title={t("consent.expiredTitle")} body={t("consent.expiredBody")} />;

  return (
    <div>
      <div className="mb-5">
        <IconTile tone="violet" className="size-10 rounded-lg [&_svg]:size-5">
          <Cable />
        </IconTile>
      </div>
      <AuthHeading title={t("consent.title", { name: req.client.name })} subtitle={t("consent.subtitle", { name: req.client.name })} />

      {failed && <Notice className="mb-4">{errorMessage(failed)}</Notice>}

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-fg" id="consent-ws">
            {t("consent.workspace")}
          </span>
          {req.workspaces.length > 1 ? (
            <Select
              aria-label={t("consent.workspace")}
              value={wid}
              onChange={setWid}
              options={req.workspaces.map((w) => ({ value: w.id, label: w.name }))}
            />
          ) : (
            <div className="flex h-8 items-center rounded-md border border-line bg-sunken px-2.5 text-[13px] text-fg" aria-labelledby="consent-ws">
              {req.workspaces[0].name}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-fg">{t("consent.access")}</span>
          <ul className="overflow-hidden rounded-md border border-line" aria-label={t("consent.access")}>
            {req.scopes.map((s, i) => {
              const on = granted.has(s);
              return (
                <motion.li
                  key={s}
                  className="flex items-start gap-2.5 border-b border-line-soft px-3 py-2 last:border-0"
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={reduce ? { duration: 0 } : { ...springs.row, delay: i * 0.03 }}
                  data-scope={s}
                  data-granted={on || undefined}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                      on ? "bg-tone-green-solid text-white" : "bg-hover text-fg-4",
                    )}
                    aria-hidden
                  >
                    {on ? <Check className="size-2.5" strokeWidth={3} /> : <Minus className="size-2.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[12.5px]", on ? "text-fg" : "text-fg-3")}>
                      {t(`scopes.${s}` as "scopes.tickets:read", { defaultValue: s, nsSeparator: false })}
                    </span>
                    {!on && <span className="block text-[11.5px] text-fg-4">{t("consent.notIncluded")}</span>}
                  </span>
                  <span className="mono shrink-0 pt-px text-[10.5px] text-fg-4">{s}</span>
                </motion.li>
              );
            })}
          </ul>
        </div>

        {ws && !ws.scopes.length && <Notice tone="info">{t("consent.noScopes")}</Notice>}

        <p className="text-[12px] leading-[18px] text-fg-3">
          {req.client.local
            ? t("consent.redirectLocal", { host: req.client.redirect_host })
            : t("consent.redirect", { host: req.client.redirect_host })}{" "}
          {t("consent.trust")}
        </p>

        <div className="flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!ws || !ws.scopes.length || leaving}
            loading={decide.isPending && decide.variables === true}
            onClick={() => decide.mutate(true)}
          >
            {leaving && decide.variables ? t("consent.returning", { name: req.client.name }) : t("consent.approve")}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="w-full"
            disabled={leaving}
            loading={decide.isPending && decide.variables === false}
            onClick={() => decide.mutate(false)}
          >
            {t("consent.deny")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Ended({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation("aiSetup");
  return (
    <div>
      <div className="mb-5">
        <IconTile tone="gray" className="size-10 rounded-lg [&_svg]:size-5">
          <Cable />
        </IconTile>
      </div>
      <AuthHeading title={title} subtitle={body} />
      <Button variant="secondary" size="lg" className="w-full" asChild>
        <Link to="/">{t("consent.goHome")}</Link>
      </Button>
    </div>
  );
}
