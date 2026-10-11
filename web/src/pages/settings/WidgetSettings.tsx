import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatePill } from "@/components/settings2/bits";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { NoAccess, Row, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea, TextInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/tabs";
import { CopyField } from "@/components/ui/copy-button";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { WidgetPreview } from "@/components/settings2/WidgetPreview";
import { UnsavedGuard } from "@/components/settings2/UnsavedGuard";
import { api } from "@/lib/api/endpoints";
import { ApiError, errorMessage } from "@/lib/api/client";
import type { WidgetSettings as WS } from "@/lib/api/types";
import { config } from "@/lib/config";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole, useWorkspace } from "@/lib/session";

const HOSTED = "https://app.opendesk.sh";

/** The widget is served by the app itself: the hosted app, or this self-hosted instance. */
function widgetOrigin() {
  if (!config.selfHosted && window.location.hostname.endsWith("opendesk.sh")) return HOSTED;
  return window.location.origin;
}

/** The API origin for `data-api`, when the widget can't infer it from where it loads. */
function widgetApi(origin: string): string | null {
  if (!config.apiUrl) return null;
  const inferred = origin === HOSTED ? "https://api.opendesk.sh" : origin;
  try {
    const a = new URL(config.apiUrl, window.location.href).origin;
    return a === inferred ? null : a;
  } catch {
    return null;
  }
}

function normalizeOrigin(v: string): string | null {
  try {
    const u = new URL(v.trim().includes("://") ? v.trim() : `https://${v.trim()}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export default function WidgetSettings() {
  const { t } = useTranslation("settingsDev");
  const reduce = useReducedMotion();
  const role = useRole();
  const admin = atLeast(role, "admin");
  const ws = useWorkspace();
  const { data: settings, isLoading } = useQuery({ ...q.widgetSettings(), enabled: admin });
  const qc = useQueryClient();
  const [draft, setDraft] = useState<WS | null>(null);
  const [originInput, setOriginInput] = useState("");
  const [originError, setOriginError] = useState<string | null>(null);
  const [previewDark, setPreviewDark] = useState(false);

  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);

  const dirty = !!draft && !!settings && JSON.stringify(draft) !== JSON.stringify(settings);

  const save = useMutation({
    mutationFn: (d: WS) => api.widgetSettings.update(d),
    onSuccess: (s) => {
      qc.setQueryData(qk.widgetSettings, s);
      setDraft(s);
      toast.success(t("widget.saved"));
    },
    onError: (e) => toast.error(e, t("widget.saveError")),
  });

  if (!admin)
    return (
      <SettingsPage title={t("widget.title")}>
        <NoAccess what="the chat widget" />
      </SettingsPage>
    );

  const set = (p: Partial<WS>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const addOrigin = () => {
    if (!draft || !originInput.trim()) return;
    const o = normalizeOrigin(originInput);
    if (!o) return setOriginError(t("widget.originInvalid"));
    setOriginError(null);
    if (!draft.allowed_origins.includes(o)) set({ allowed_origins: [...draft.allowed_origins, o] });
    setOriginInput("");
  };

  const origin = widgetOrigin();
  const apiAttr = widgetApi(origin);
  const snippet = `<script src="${origin}/widget/v1.js" data-key="${ws?.widget_key ?? "wk_..."}"${apiAttr ? ` data-api="${apiAttr}"` : ""} async></script>`;
  const identify = `window.opendesk('identify', {
  user_id: "42",
  user_hash: "<hmac from your server>",
  email: "ada@example.com",
  name: "Ada Lovelace",
});`;

  return (
    <SettingsPage
      wide
      title={t("widget.title")}
      description={t("widget.description")}
      actions={
        draft && (
          <StatePill state={draft.enabled ? "active" : "disabled"}>{draft.enabled ? t("widget.live") : t("widget.hidden")}</StatePill>
        )
      }
    >
      <UnsavedGuard when={dirty && !save.isPending} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-8">
          <Section title={t("widget.settings")} description={t("widget.settingsHint")}>
            {isLoading || !draft ? (
              <div className="flex flex-col gap-3 py-3">
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-16" />
                <div className="skeleton h-4 w-2/3" />
              </div>
            ) : (
              <>
                <Row label={t("widget.show")} description={t("widget.showHint")}>
                  <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label="Show the widget" />
                </Row>
                <Row label={t("widget.greeting")} description={t("widget.greetingHint")} stack htmlFor="widget-greeting">
                  <Textarea
                    id="widget-greeting"
                    value={draft.greeting}
                    maxLength={280}
                    rows={2}
                    placeholder={t("widget.greetingPlaceholder")}
                    onChange={(e) => set({ greeting: e.target.value })}
                  />
                </Row>
                <Row label={t("widget.requireEmail")} description={t("widget.requireEmailHint")}>
                  <Switch checked={draft.require_email} onCheckedChange={(require_email) => set({ require_email })} aria-label="Ask for an email first" />
                </Row>
                <Row
                  label={t("widget.origins")}
                  description={t("widget.originsHint")}
                  stack
                  htmlFor="widget-origin"
                >
                  <div className="flex flex-col gap-2">
                    {draft.allowed_origins.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {draft.allowed_origins.map((o) => (
                          <span key={o} className="mono inline-flex h-6 animate-pop-in items-center gap-1.5 rounded-sm border border-line bg-sunken pl-2 pr-0.5 text-[11.5px] text-fg-2 motion-reduce:animate-none">
                            <span className="size-1.5 rounded-full bg-tone-green-solid" aria-hidden />
                            {o}
                            <button
                              type="button"
                              aria-label={`Remove ${o}`}
                              onClick={() => set({ allowed_origins: draft.allowed_origins.filter((x) => x !== o) })}
                              className="flex size-5 items-center justify-center rounded-xs text-fg-4 transition-colors hover:bg-hover hover:text-fg"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <TextInput
                        id="widget-origin"
                        inputSize="sm"
                        value={originInput}
                        invalid={!!originError}
                        placeholder="https://www.example.com"
                        className="mono"
                        onChange={(e) => {
                          setOriginInput(e.target.value);
                          setOriginError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === ",") {
                            e.preventDefault();
                            addOrigin();
                          }
                        }}
                      />
                      <Button size="sm" onClick={addOrigin} disabled={!originInput.trim()}>
                        Add
                      </Button>
                    </div>
                    {originError && (
                      <p role="alert" className="text-xs text-danger-fg">
                        {originError}
                      </p>
                    )}
                    {!draft.allowed_origins.length && !originError && <p className="text-[12px] text-fg-4">{t("widget.anySite")}</p>}
                  </div>
                </Row>
              </>
            )}
          </Section>

          <AnimatePresence initial={false}>
            {dirty && draft && (
              <motion.div
                key="savebar"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 8, transition: { duration: 0.14 } }}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="sticky bottom-4 z-10 -mt-4 flex items-center gap-3 rounded-lg border border-line bg-raised px-4 py-2.5 shadow-pop"
              >
                <span className="size-1.5 rounded-full bg-tone-amber-solid" aria-hidden />
                <span className="flex-1 text-[12.5px] text-fg-2">{t("widget.unsaved")}</span>
                <Button size="sm" variant="ghost" onClick={() => settings && setDraft(settings)}>
                  {t("widget.revert")}
                </Button>
                <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate(draft)}>
                  Save changes
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <Section title={t("widget.install")} description={t("widget.installHint")}>
            <div className="flex flex-col gap-3 py-3">
              <CopyField value={snippet} multiline />
              <div className="flex items-center gap-2 text-[12px] text-fg-3">
                {t("widget.key")} <span className="mono text-fg-2">{ws?.widget_key}</span>
              </div>
            </div>
          </Section>

          <Section title={t("widget.identify")} description={t("widget.identifyHint")}>
            <div className="flex flex-col gap-3 py-3">
              <CopyField value={identify} multiline />
              <p className="text-[12.5px] leading-5 text-fg-3">
                Compute <span className="mono text-fg-2">user_hash</span> on your server as the hex HMAC-SHA256 of the <span className="mono text-fg-2">user_id</span>, keyed with your widget secret. Never put the secret in browser code. Sessions without a valid hash still work, but are marked unverified.
              </p>
              {atLeast(role, "admin") && <RotateSecret />}
            </div>
          </Section>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{t("widget.preview")}</h2>
            <Segmented
              size="xs"
              value={previewDark ? "dark" : "light"}
              onChange={(v) => setPreviewDark(v === "dark")}
              options={[
                { value: "light", label: t("widget.light"), icon: <Sun /> },
                { value: "dark", label: t("widget.dark"), icon: <Moon /> },
              ]}
            />
          </div>
          <WidgetPreview
            workspaceName={ws?.name ?? "Your workspace"}
            greeting={draft?.greeting ?? ""}
            brandColor={ws?.settings.brand_color}
            requireEmail={draft?.require_email ?? false}
            enabled={draft?.enabled ?? true}
            dark={previewDark}
          />
          <p className="mt-2 text-[12px] text-fg-3">
            {ws?.settings.brand_color ? (
              <>
                <span className="mr-1 inline-block size-2.5 rounded-xs align-[-1px]" style={{ background: ws.settings.brand_color }} aria-hidden />
                {t("widget.accent")} <span className="mono text-fg-2">{ws.settings.brand_color}</span> {t("widget.accentSuffix")}
              </>
            ) : (
              t("widget.noAccent")
            )}
          </p>
        </div>
      </div>
    </SettingsPage>
  );
}

function RotateSecret() {
  const { t } = useTranslation("settingsDev");
  const confirm = useConfirm();
  const [secret, setSecret] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const rotate = async () => {
    setBlocked(null);
    try {
      const r = await api.workspaces.rotateWidgetSecret();
      setSecret(r.secret);
    } catch (e) {
      if (e instanceof ApiError && e.code === "mfa_required") {
        setBlocked("Rotating the secret needs two-factor authentication. Turn on 2FA in Security, then sign in again.");
        return;
      }
      if (e instanceof ApiError && e.code === "reauth_required") {
        setBlocked("For safety, sign out and sign back in, then try again. This needs a login from the last 12 hours.");
        return;
      }
      throw new Error(errorMessage(e, "Couldn't rotate the secret"), { cause: e });
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-md border border-line px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">{t("widget.secret")}</div>
          <div className="text-[12px] text-fg-3">{t("widget.secretHint")}</div>
        </div>
        <Button
          size="sm"
          icon={<KeyRound className="size-3.5" />}
          onClick={() =>
            confirm.show("Identified sessions stop verifying until you deploy the new secret. Existing chats keep working.", rotate, {
              title: "Rotate the widget secret?",
              confirmLabel: "Rotate secret",
              danger: true,
            })
          }
        >
          Rotate secret
        </Button>
      </div>
      {blocked && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-tone-amber-soft px-3 py-2 text-[12.5px] text-tone-amber">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-tone-amber-solid" />
          {blocked}
        </p>
      )}
      <Dialog
        open={!!secret}
        onOpenChange={(o) => !o && setSecret(null)}
        title="New widget secret"
        description="Copy it now and store it on your server. You won't see it again."
        footer={
          <Button variant="primary" onClick={() => setSecret(null)}>
            I've saved it
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-1">
          <CopyField value={secret ?? ""} />
          <p className="flex items-start gap-2 text-[12px] text-fg-3">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
            Treat it like a password. Anyone with it can impersonate your users in chat.
          </p>
        </div>
      </Dialog>
    </>
  );
}
