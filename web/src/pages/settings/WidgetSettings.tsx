// Settings > Chat widget: an editor on the left (appearance, header, home
// screen, behaviour, install) and the real widget on the right, live, following
// every unsaved change. Pictures upload straight away; everything else saves
// together from the save bar.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, KeyRound, LayoutPanelLeft, MessageCircle, MessagesSquare, Monitor, Moon, PanelRight, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatePill } from "@/components/settings2/bits";
import { NoAccess, Row, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea, TextInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/tabs";
import { CopyField } from "@/components/ui/copy-button";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { ImageUpload } from "@/components/ui/image-upload";
import { Stepper } from "@/components/settings2/Stepper";
import { SaveBar } from "@/components/settings/SaveBar";
import { UnsavedGuard } from "@/components/settings2/UnsavedGuard";
import { OllieMark } from "@/components/assistant/OllieMark";
import { ChipEditor } from "@/components/agent/ChipEditor";
import { Counter } from "@/components/agent/bits";
import { agentSettings } from "@/components/agent/settings";
import { LivePreview, type PreviewScene } from "@/components/widget/LivePreview";
import { ColorField, hasMarkup, HEX, LIMITS, suggestionProblem, SuggestionsEditor, tidy, toWidgetConfig } from "@/components/widget/fields";
import { useWorkspaceImage } from "@/lib/pictures";
import type { WorkspaceImageSlot } from "@/lib/api/types";
import { api } from "@/lib/api/endpoints";
import { ApiError, errorMessage } from "@/lib/api/client";
import type { WidgetSettings as WS } from "@/lib/api/types";
import { useAI } from "@/lib/ai";
import { config } from "@/lib/config";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole, useWorkspace } from "@/lib/session";
import { AI_TONE, tone } from "@/lib/tones";
import { cn } from "@/lib/cn";

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

/** Defaults for keys an older server leaves out (contracts/api.md). */
function withDefaults(s: WS): WS {
  return {
    ...s,
    color: s.color ?? "",
    theme: s.theme ?? "auto",
    position: s.position ?? "right",
    offset_x: s.offset_x ?? 20,
    offset_y: s.offset_y ?? 20,
    launcher: s.launcher ?? "icon",
    launcher_label: s.launcher_label ?? "",
    radius: s.radius ?? "soft",
    title: s.title ?? "",
    subtitle: s.subtitle ?? "",
    show_team: s.show_team ?? true,
    suggestions: s.suggestions ?? [],
    sound: s.sound ?? false,
    bot_name: s.bot_name ?? "",
  };
}

type TextKey = "greeting" | "launcher_label" | "title" | "subtitle";

export default function WidgetSettings() {
  const { t } = useTranslation("settingsDev");
  const role = useRole();
  const admin = atLeast(role, "admin");
  const ws = useWorkspace();
  const ai = useAI();
  const { data: raw, isLoading } = useQuery({ ...q.widgetSettings(), enabled: admin });
  const { data: members } = useQuery({ ...q.members(), enabled: admin });
  const settings = useMemo(() => (raw ? withDefaults(raw) : undefined), [raw]);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<WS | null>(null);
  const [scene, setScene] = useState<PreviewScene>("home");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);
  // A fixed theme decides the preview's; "auto" leaves the toggle to you.
  useEffect(() => {
    if (draft?.theme === "light") setDark(false);
    else if (draft?.theme === "dark") setDark(true);
  }, [draft?.theme]);

  const dirty = !!draft && !!settings && JSON.stringify(draft) !== JSON.stringify(settings);
  const agentOn = ai.enabled && agentSettings(ai.features).widget_answers;
  const preview = useMemo(() => (draft ? toWidgetConfig(draft, ws, members, agentOn) : null), [draft, ws, members, agentOn]);

  const textError = (k: TextKey): string | null => {
    if (!draft) return null;
    const v = draft[k];
    if (tidy(v).length > LIMITS[k]) return t("widget.tooLong", { max: LIMITS[k] });
    if (hasMarkup(v)) return t("widget.noMarkup");
    return null;
  };
  const invalid =
    !!draft &&
    ((["greeting", "launcher_label", "title", "subtitle"] as TextKey[]).some((k) => textError(k)) ||
      draft.suggestions.some((s) => suggestionProblem(s)) ||
      (draft.color !== "" && !HEX.test(draft.color)));

  const save = useMutation({
    mutationFn: (d: WS) => {
      // PATCH merges, so only what changed goes up.
      const patch: Partial<WS> = {};
      for (const k of Object.keys(d) as (keyof WS)[]) {
        if (JSON.stringify(d[k]) !== JSON.stringify(settings?.[k])) (patch as Record<string, unknown>)[k] = d[k];
      }
      if (patch.suggestions) patch.suggestions = patch.suggestions.map(tidy);
      for (const k of ["launcher_label", "title", "subtitle"] as const) if (patch[k] !== undefined) patch[k] = tidy(patch[k]!);
      return api.widgetSettings.update(patch);
    },
    onMutate: async (d) => {
      await qc.cancelQueries({ queryKey: qk.widgetSettings });
      const prev = qc.getQueryData<WS>(qk.widgetSettings);
      qc.setQueryData(qk.widgetSettings, d);
      return { prev };
    },
    onSuccess: (s) => {
      qc.setQueryData(qk.widgetSettings, s);
      setDraft(withDefaults(s));
      toast.success(t("widget.saved"));
    },
    onError: (e, _d, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.widgetSettings, ctx.prev);
      toast.error(e, t("widget.saveError"));
    },
  });

  if (!admin)
    return (
      <SettingsPage title={t("widget.title")}>
        <NoAccess what={t("widget.what")} />
      </SettingsPage>
    );

  const set = (p: Partial<WS>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const origin = widgetOrigin();
  const apiAttr = widgetApi(origin);
  const snippet = `<script src="${origin}/widget/v1.js" data-key="${ws?.widget_key ?? "wk_..."}"${apiAttr ? ` data-api="${apiAttr}"` : ""} async></script>`;
  const identify = `window.opendesk('identify', {
  user_id: "42",
  user_hash: "<hmac from your server>",
  email: "ada@example.com",
  name: "Ada Lovelace",
});`;

  const text = (k: TextKey, placeholder: string, opts: { area?: boolean; className?: string } = {}) => {
    if (!draft) return null;
    const err = textError(k);
    const common = { id: `widget-${k}`, value: draft[k], invalid: !!err, placeholder, "aria-describedby": err ? `widget-${k}-err` : undefined };
    return (
      <div className={cn("flex flex-col gap-1", opts.className)}>
        {opts.area ? (
          <Textarea {...common} rows={3} maxLength={LIMITS[k] + 20} onChange={(e) => set({ [k]: e.target.value })} />
        ) : (
          <TextInput {...common} maxLength={LIMITS[k] + 10} onChange={(e) => set({ [k]: e.target.value })} />
        )}
        <div className="flex items-start justify-between gap-3">
          {err ? (
            <span id={`widget-${k}-err`} role="alert" className="text-xs text-danger-fg">
              {err}
            </span>
          ) : (
            <span />
          )}
          <Counter n={tidy(draft[k]).length} max={LIMITS[k]} />
        </div>
      </div>
    );
  };

  return (
    <SettingsPage
      wide
      title={t("widget.title")}
      description={t("widget.description")}
      actions={draft && <StatePill state={draft.enabled ? "active" : "disabled"}>{draft.enabled ? t("widget.live") : t("widget.hidden")}</StatePill>}
    >
      <UnsavedGuard when={dirty && !save.isPending} />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-8">
          {isLoading || !draft ? (
            <div className="flex flex-col gap-3">
              <div className="skeleton h-40 rounded-lg" />
              <div className="skeleton h-28 rounded-lg" />
            </div>
          ) : (
            <>
              <div onFocusCapture={() => setScene((s) => (s === "chat" ? s : "launcher"))}>
                <Section title={t("widget.appearance")} description={t("widget.appearanceHint")}>
                  <Row label={t("widget.color")} description={t("widget.colorHint")} stack>
                    <ColorField value={draft.color} onChange={(color) => set({ color })} brand={ws?.settings.brand_color} />
                  </Row>
                  <Row label={t("widget.theme")} description={t("widget.themeHint")}>
                    <Segmented
                      size="xs"
                      value={draft.theme}
                      onChange={(theme) => set({ theme })}
                      options={[
                        { value: "auto", label: t("widget.themeAuto"), icon: <Monitor /> },
                        { value: "light", label: t("widget.light"), icon: <Sun /> },
                        { value: "dark", label: t("widget.dark"), icon: <Moon /> },
                      ]}
                    />
                  </Row>
                  <Row label={t("widget.position")} description={t("widget.positionHint")}>
                    <Segmented
                      size="xs"
                      value={draft.position}
                      onChange={(position) => set({ position })}
                      options={[
                        { value: "left", label: t("widget.left"), icon: <LayoutPanelLeft /> },
                        { value: "right", label: t("widget.right"), icon: <PanelRight /> },
                      ]}
                    />
                  </Row>
                  <Row label={t("widget.offset")} description={t("widget.offsetHint")} stack>
                    <div className="flex flex-wrap items-center gap-2">
                      <Stepper value={draft.offset_x} onChange={(offset_x) => set({ offset_x })} min={0} max={200} step={4} suffix="px" aria-label={t("widget.offsetX")} className="w-[124px]" />
                      <span className="text-xs text-fg-3">{t("widget.offsetXShort")}</span>
                      <Stepper value={draft.offset_y} onChange={(offset_y) => set({ offset_y })} min={0} max={200} step={4} suffix="px" aria-label={t("widget.offsetY")} className="ml-2 w-[124px]" />
                      <span className="text-xs text-fg-3">{t("widget.offsetYShort")}</span>
                    </div>
                  </Row>
                  <Row label={t("widget.radius")} description={t("widget.radiusHint")}>
                    <Segmented
                      size="xs"
                      value={draft.radius}
                      onChange={(radius) => set({ radius })}
                      options={(["square", "soft", "round"] as const).map((r) => ({
                        value: r,
                        label: t(`widget.radius_${r}`),
                        icon: <span className={cn("block size-3 border-[1.5px] border-current", r === "square" ? "rounded-[1px]" : r === "soft" ? "rounded-[4px]" : "rounded-full")} />,
                      }))}
                    />
                  </Row>
                  <Row label={t("widget.launcherStyle")} description={t("widget.launcherStyleHint")} stack={draft.launcher === "label"}>
                    <div className="flex flex-col gap-2">
                      <Segmented
                        size="xs"
                        className="self-start"
                        value={draft.launcher}
                        onChange={(launcher) => set({ launcher })}
                        options={[
                          { value: "icon", label: t("widget.launcherIcon") },
                          { value: "label", label: t("widget.launcherLabel") },
                        ]}
                      />
                      {draft.launcher === "label" && text("launcher_label", t("widget.launcherLabelPlaceholder"), { className: "max-w-[320px]" })}
                    </div>
                  </Row>
                  {ws && <ImageRow slot="widget_launcher" label={t("widget.launcher")} hint={t("widget.launcherHint")} />}
                </Section>
              </div>

              <div onFocusCapture={() => setScene("home")}>
                <Section title={t("widget.header")} description={t("widget.headerHint")}>
                  <Row label={t("widget.titleField")} description={t("widget.titleHint")} htmlFor="widget-title" stack>
                    {text("title", ws?.name ?? "", { className: "max-w-[420px]" })}
                  </Row>
                  <Row label={t("widget.subtitle")} description={t("widget.subtitleHint")} htmlFor="widget-subtitle" stack>
                    {text("subtitle", t("widget.subtitlePlaceholder"), { className: "max-w-[420px]" })}
                  </Row>
                  <Row label={t("widget.showTeam")} description={t("widget.showTeamHint")}>
                    <Switch checked={draft.show_team} onCheckedChange={(show_team) => set({ show_team })} aria-label={t("widget.showTeam")} />
                  </Row>
                  {ws && <ImageRow slot="widget_avatar" label={t("widget.avatar")} hint={t("widget.avatarHint")} />}
                </Section>
              </div>

              <div onFocusCapture={() => setScene("home")}>
                <Section title={t("widget.home")} description={t("widget.homeHint")}>
                  <Row label={t("widget.greeting")} description={t("widget.greetingHint")} stack htmlFor="widget-greeting">
                    {text("greeting", t("widget.greetingPlaceholder"), { area: true })}
                  </Row>
                  <Row label={t("widget.suggestions")} description={t("widget.suggestionsHint")} stack>
                    <SuggestionsEditor value={draft.suggestions} onChange={(suggestions) => set({ suggestions })} />
                  </Row>
                </Section>
              </div>

              <Section title={t("widget.settings")} description={t("widget.settingsHint")}>
                <Row label={t("widget.show")} description={t("widget.showHint")}>
                  <Switch checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} aria-label={t("widget.show")} />
                </Row>
                <Row label={t("widget.requireEmail")} description={t("widget.requireEmailHint")}>
                  <Switch checked={draft.require_email} onCheckedChange={(require_email) => set({ require_email })} aria-label={t("widget.requireEmail")} />
                </Row>
                <Row label={t("widget.sound")} description={t("widget.soundHint")}>
                  <Switch checked={draft.sound} onCheckedChange={(sound) => set({ sound })} aria-label={t("widget.sound")} />
                </Row>
                <Row label={t("widget.origins")} description={t("widget.originsHint")} stack>
                  <ChipEditor
                    mono
                    values={draft.allowed_origins}
                    onChange={(allowed_origins) => set({ allowed_origins })}
                    max={LIMITS.origins}
                    normalize={normalizeOrigin}
                    placeholder="https://www.example.com"
                    aria-label={t("widget.origins")}
                    dot="bg-tone-green-solid"
                    empty={t("widget.anySite")}
                  />
                </Row>
                {ai.enabled && <AgentLink on={agentOn} />}
              </Section>
            </>
          )}

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
              <p className="text-[12.5px] leading-5 text-fg-3">{t("widget.identifyBody")}</p>
              <RotateSecret />
            </div>
          </Section>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold tracking-[-0.01em]">{t("widget.preview")}</h2>
            <div className="flex items-center gap-1.5">
              <Segmented<PreviewScene>
                size="xs"
                value={scene}
                onChange={setScene}
                options={[
                  { value: "launcher", label: t("widget.sceneLauncher"), icon: <MessageCircle /> },
                  { value: "home", label: t("widget.sceneHome") },
                  { value: "chat", label: t("widget.sceneChat"), icon: <MessagesSquare /> },
                ]}
              />
              <Segmented
                size="xs"
                value={dark ? "dark" : "light"}
                onChange={(v) => setDark(v === "dark")}
                options={[
                  { value: "light", label: <span className="sr-only">{t("widget.light")}</span>, icon: <Sun /> },
                  { value: "dark", label: <span className="sr-only">{t("widget.dark")}</span>, icon: <Moon /> },
                ]}
              />
            </div>
          </div>
          {preview ? <LivePreview config={preview} scene={scene} dark={dark} className="h-[min(680px,calc(100vh-140px))] min-h-[560px]" /> : <div className="skeleton h-[600px] rounded-xl" />}
          <p className="mt-2 text-[12px] leading-[18px] text-fg-3">{draft && !draft.enabled ? t("widget.previewHidden") : t("widget.previewHint")}</p>
        </div>
      </div>
      <SaveBar dirty={dirty} saving={save.isPending} disabled={invalid} onSave={() => draft && save.mutate(draft)} onDiscard={() => settings && setDraft(settings)} />
    </SettingsPage>
  );
}

/** Where the AI agent is set up, and whether it answers in this widget. */
function AgentLink({ on }: { on: boolean }) {
  const { t } = useTranslation("settingsDev");
  return (
    <div className="py-3.5">
      <Link
        to="/settings/ai/behaviour"
        className={cn("group flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors", on ? cn(tone[AI_TONE].soft, tone[AI_TONE].line) : "border-line bg-sunken hover:bg-hover")}
      >
        <OllieMark size={22} tone={on ? "color" : "muted"} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-fg">{on ? t("widget.agentOn") : t("widget.agentOff")}</span>
          <span className="block text-[12px] text-fg-3">{t("widget.agentHint")}</span>
        </span>
        <ArrowRight className="size-3.5 text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </Link>
    </div>
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
      if (e instanceof ApiError && e.code === "mfa_required") return setBlocked(t("widget.rotateMfa"));
      if (e instanceof ApiError && e.code === "reauth_required") return setBlocked(t("widget.rotateReauth"));
      throw new Error(errorMessage(e, t("widget.rotateError")), { cause: e });
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
          onClick={() => confirm.show(t("widget.rotateBody"), rotate, { title: t("widget.rotateTitle"), confirmLabel: t("widget.rotate"), danger: true })}
        >
          {t("widget.rotate")}
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
        title={t("widget.newSecret")}
        description={t("widget.newSecretHint")}
        footer={
          <Button variant="primary" onClick={() => setSecret(null)}>
            {t("widget.savedIt")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-1">
          <CopyField value={secret ?? ""} />
          <p className="flex items-start gap-2 text-[12px] text-fg-3">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warn" />
            {t("widget.secretWarning")}
          </p>
        </div>
      </Dialog>
    </>
  );
}

/** A widget picture, uploaded straight away (not part of the draft). */
function ImageRow({ slot, label, hint }: { slot: WorkspaceImageSlot; label: string; hint: string }) {
  const ws = useWorkspace();
  const images = useWorkspaceImage();
  if (!ws) return null;
  const src = ws.images?.[slot] ?? null;
  return (
    <Row label={label} description={hint}>
      <ImageUpload
        name={ws.name}
        shape="round"
        size="md"
        value={src}
        onChange={async (f) => {
          await images.upload.mutateAsync({ slot, file: f });
        }}
        onRemove={
          src
            ? async () => {
                try {
                  await images.remove.mutateAsync(slot);
                } catch (e) {
                  toast.error(e);
                }
              }
            : undefined
        }
      />
    </Row>
  );
}
