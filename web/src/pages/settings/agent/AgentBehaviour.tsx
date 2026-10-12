// Settings > AI agent > Behaviour (contracts/agent.md): turn the widget agent
// on, name it, give it a picture, tell it what to know, pick its model and
// set guardrails. Unsaved edits travel to the playground so they can be tried
// before they are saved.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ClipboardCheck, FlaskConical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoAccess, Row, Section, SettingsPage } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea, TextInput } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/image-upload";
import { toast } from "@/components/ui/toast";
import { Stepper } from "@/components/settings2/Stepper";
import { IconTile } from "@/components/settings2/bits";
import { SaveBar } from "@/components/settings/SaveBar";
import { UnsavedGuard } from "@/components/settings2/UnsavedGuard";
import { OllieMark } from "@/components/assistant/OllieMark";
import { ModelPicker } from "@/components/ai/ModelPicker";
import { ChipEditor } from "@/components/agent/ChipEditor";
import { EmailMailboxes } from "@/components/agent/EmailMailboxes";
import { BotAvatar, Counter, CreditsField } from "@/components/agent/bits";
import {
  agentSettings,
  BOT_NAME_MAX,
  playgroundSettings,
  CAP_MAX,
  INSTRUCTIONS_MAX,
  TOPICS_MAX,
  topicProblem,
  useAgentDraft,
  type AgentSettings,
} from "@/components/agent/settings";
import { api } from "@/lib/api/endpoints";
import type { AIConfig, AISettings, WidgetSettings } from "@/lib/api/types";
import { useWorkspaceImage } from "@/lib/pictures";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole, useWorkspace } from "@/lib/session";
import { AI_TONE } from "@/lib/tones";
import { cn } from "@/lib/cn";

const PLAYGROUND = "/settings/ai/playground";
const TESTS = "/settings/ai/tests";

export default function AgentBehaviour() {
  const { t } = useTranslation("agent");
  const admin = atLeast(useRole(), "admin");
  const { data: config, isLoading } = useQuery(q.aiConfig());
  const { data: widget } = useQuery({ ...q.widgetSettings(), enabled: admin });
  const { data: models } = useQuery({ ...q.aiModels(), enabled: admin && !!config?.enabled });
  const qc = useQueryClient();
  const kept = useAgentDraft((s) => s.draft);
  const setKept = useAgentDraft((s) => s.setDraft);

  const base = useMemo(() => agentSettings(config?.features), [config?.features]);
  const baseName = widget?.bot_name ?? "";
  const [draft, setDraft] = useState<AgentSettings>(() => kept?.ai ?? base);
  const [botName, setBotName] = useState(() => kept?.botName ?? baseName);
  const [touched, setTouched] = useState(!!kept);

  // Follow the server until the first edit (realtime, the first load).
  useEffect(() => {
    if (!touched) setDraft(base);
  }, [base, touched]);
  useEffect(() => {
    if (!touched) setBotName(baseName);
  }, [baseName, touched]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(base) || botName.trim() !== baseName;
  // Unsaved edits stay available to the playground, and come back here.
  useEffect(() => {
    setKept(dirty ? { ai: draft, botName } : null);
  }, [dirty, draft, botName, setKept]);

  const set = (p: Partial<AgentSettings>) => {
    setTouched(true);
    setDraft((d) => ({ ...d, ...p }));
  };

  const tooLong = draft.widget_instructions.length > INSTRUCTIONS_MAX;
  const nameBad = botName.trim().length > BOT_NAME_MAX || /[<>]/.test(botName);

  const save = useMutation({
    mutationFn: async () => {
      const patch: Partial<AISettings> = {};
      for (const k of Object.keys(draft) as (keyof AgentSettings)[]) {
        if (JSON.stringify(draft[k]) !== JSON.stringify(base[k])) (patch as Record<string, unknown>)[k] = draft[k];
      }
      const name = botName.trim().replace(/\s+/g, " ");
      const [features, w] = await Promise.all([
        Object.keys(patch).length ? api.ai.updateSettings(patch) : Promise.resolve(null),
        name !== baseName ? api.widgetSettings.update({ bot_name: name }) : Promise.resolve(null),
      ]);
      return { features, w };
    },
    onSuccess: ({ features, w }) => {
      if (features) qc.setQueryData<AIConfig | null>(qk.aiConfig, (old) => (old ? { ...old, features } : old));
      if (w) qc.setQueryData<WidgetSettings>(qk.widgetSettings, w);
      setTouched(false);
      setKept(null);
      toast.success(t("behaviour.saved"));
    },
    onError: (e) => toast.error(e, t("behaviour.saveError")),
  });

  // Run the agent's tests, against these edits when there are any.
  const { t: tq } = useTranslation("agentQuality");
  const navigate = useNavigate();
  const runTests = useMutation({
    mutationFn: () => api.ai.agent.runs.start({ settings: dirty ? playgroundSettings({ ai: draft, botName }) : undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.agentTestRuns });
      void navigate({ to: TESTS });
    },
    onError: (e) => toast.error(e, tq("behaviour.runError")),
  });

  const discard = () => {
    setDraft(base);
    setBotName(baseName);
    setTouched(false);
    setKept(null);
  };

  if (!admin)
    return (
      <SettingsPage title={t("behaviour.title")}>
        <NoAccess what={t("behaviour.what")} />
      </SettingsPage>
    );

  const defaultModel = config?.features?.model || config?.models.default || models?.default || "";
  const off = !draft.widget_answers;

  return (
    <SettingsPage
      title={t("behaviour.title")}
      description={t("behaviour.description")}
      actions={
        <>
          <Button icon={<ClipboardCheck className="size-3.5 text-fg-3" />} loading={runTests.isPending} disabled={tooLong || nameBad} onClick={() => runTests.mutate()}>
            {dirty ? tq("behaviour.runTestsDraft") : tq("behaviour.runTests")}
          </Button>
          <Button asChild>
            <Link to={PLAYGROUND}>
              <FlaskConical className="size-3.5 text-fg-3" />
              {dirty ? t("behaviour.tryChanges") : t("behaviour.openPlayground")}
            </Link>
          </Button>
        </>
      }
    >
      <UnsavedGuard when={dirty && !save.isPending} allow={(p) => p === PLAYGROUND || p === TESTS} />
      {isLoading || !config ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      ) : (
        <>
          <Section>
            <div className="flex items-center gap-3.5 py-3.5">
              <IconTile tone={off ? "gray" : AI_TONE} className="size-9 transition-colors duration-200">
                <OllieMark size={20} tone={off ? "muted" : "color"} />
              </IconTile>
              <div className="min-w-0 flex-1">
                <label htmlFor="agent-on" className="text-[12.5px] font-medium text-fg">
                  {t("behaviour.enable")}
                </label>
                <div className="mt-0.5 text-[12px] leading-[18px] text-fg-3">{t("behaviour.enableHint")}</div>
              </div>
              <Switch id="agent-on" checked={draft.widget_answers} onCheckedChange={(widget_answers) => set({ widget_answers })} aria-label={t("behaviour.enable")} />
            </div>
          </Section>

          <Section title={t("behaviour.identity")} description={t("behaviour.identityHint")}>
            <Row label={t("behaviour.name")} description={t("behaviour.nameHint")} htmlFor="agent-name">
              <div className="flex flex-col items-end gap-1">
                <TextInput
                  id="agent-name"
                  value={botName}
                  maxLength={BOT_NAME_MAX + 10}
                  invalid={nameBad}
                  placeholder="Ollie"
                  className="w-[220px]"
                  onChange={(e) => {
                    setTouched(true);
                    setBotName(e.target.value);
                  }}
                />
                {nameBad && <span className="text-xs text-danger-fg">{t("behaviour.nameInvalid", { max: BOT_NAME_MAX })}</span>}
              </div>
            </Row>
            <BotPicture name={botName.trim() || "Ollie"} />
          </Section>

          <Section title={t("behaviour.know")} description={t("behaviour.knowHint")}>
            <Row label={t("behaviour.instructions")} description={t("behaviour.instructionsHint")} stack htmlFor="agent-instructions">
              <div className="flex flex-col gap-1">
                <Textarea
                  id="agent-instructions"
                  value={draft.widget_instructions}
                  invalid={tooLong}
                  rows={8}
                  placeholder={t("behaviour.instructionsPlaceholder")}
                  onChange={(e) => set({ widget_instructions: e.target.value })}
                />
                <div className="flex items-center justify-between gap-3">
                  <Link to="/settings/ai/knowledge" className="text-[12px] text-fg-3 underline decoration-line-strong underline-offset-2 hover:text-fg">
                    {t("behaviour.knowledgeLink")}
                  </Link>
                  <Counter n={draft.widget_instructions.length} max={INSTRUCTIONS_MAX} />
                </div>
              </div>
            </Row>
          </Section>

          <Section title={t("behaviour.model")} description={t("behaviour.modelHint")}>
            <Row label={t("behaviour.widgetModel")} description={t("behaviour.widgetModelHint")} stack>
              <ModelPicker
                value={draft.widget_model}
                onChange={(widget_model) => set({ widget_model })}
                models={models?.data}
                defaultId={defaultModel}
                defaultLabel={t("behaviour.sameAsMain")}
                aria-label={t("behaviour.widgetModel")}
                className="max-w-[460px]"
              />
            </Row>
            <Row label={t("behaviour.maxReplies")} description={t("behaviour.maxRepliesHint")}>
              <Stepper
                value={draft.widget_max_replies}
                onChange={(widget_max_replies) => set({ widget_max_replies })}
                min={1}
                max={100}
                aria-label={t("behaviour.maxReplies")}
                suffix={t("behaviour.repliesSuffix")}
                className="w-[150px]"
              />
            </Row>
          </Section>

          <Section title={t("behaviour.guardrails")} description={t("behaviour.guardrailsHint")}>
            <Row label={t("behaviour.topics")} description={t("behaviour.topicsHint")} stack>
              <ChipEditor
                values={draft.widget_blocked_topics}
                onChange={(widget_blocked_topics) => set({ widget_blocked_topics })}
                max={TOPICS_MAX}
                placeholder={t("behaviour.topicsPlaceholder")}
                aria-label={t("behaviour.topics")}
                normalize={(v) => v.trim().replace(/\s+/g, " ")}
                validate={(v) => {
                  const p = topicProblem(v);
                  return p ? t(`behaviour.topic_${p}`) : null;
                }}
                dot="bg-tone-red-solid"
                empty={t("behaviour.topicsEmpty")}
              />
            </Row>
            <Row label={t("behaviour.cap")} description={t("behaviour.capHint")} stack>
              <CreditsField
                value={draft.widget_monthly_cap}
                onChange={(widget_monthly_cap) => set({ widget_monthly_cap })}
                max={CAP_MAX}
                presets={[100, 500, 1000, 5000]}
                zeroLabel={t("behaviour.noCap")}
                aria-label={t("behaviour.cap")}
              />
            </Row>
            <Row label={t("behaviour.collectEmail")} description={t("behaviour.collectEmailHint")}>
              <Switch checked={draft.widget_collect_email} onCheckedChange={(widget_collect_email) => set({ widget_collect_email })} aria-label={t("behaviour.collectEmail")} />
            </Row>
          </Section>

          <EmailMailboxes />
        </>
      )}

      <SaveBar dirty={dirty} saving={save.isPending} disabled={tooLong || nameBad} onSave={() => save.mutate()} onDiscard={discard} />
    </SettingsPage>
  );
}

/** The agent's picture (the `widget_bot` image slot). It saves as soon as it is uploaded. */
function BotPicture({ name }: { name: string }) {
  const { t } = useTranslation("agent");
  const ws = useWorkspace();
  const images = useWorkspaceImage();
  const src = ws?.images?.widget_bot ?? null;
  return (
    <Row label={t("behaviour.picture")} description={t("behaviour.pictureHint")}>
      <div className={cn("flex items-center gap-3")}>
        <ImageUpload
          name={name}
          shape="round"
          size="md"
          value={src}
          hint={false}
          placeholder={<BotAvatar size={30} />}
          onChange={async (file) => {
            await images.upload.mutateAsync({ slot: "widget_bot", file });
          }}
          onRemove={
            src
              ? async () => {
                  try {
                    await images.remove.mutateAsync("widget_bot");
                  } catch (e) {
                    toast.error(e);
                  }
                }
              : undefined
          }
        />
      </div>
    </Row>
  );
}
