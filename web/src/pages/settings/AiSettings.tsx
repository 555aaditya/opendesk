import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Row, Section, SettingsPage } from "@/components/layout";
import { AiIcon } from "@/components/ai/bits";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/tabs";
import { Textarea, TextInput } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { SaveBar } from "@/components/settings/SaveBar";
import { UnsavedGuard } from "@/components/settings2/UnsavedGuard";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import type { AIConfig, AIFeature, AISettings } from "@/lib/api/types";
import { q, qk } from "@/lib/queries";
import { atLeast, useRole } from "@/lib/session";
import { cn } from "@/lib/cn";

const PRESET_TONES = ["friendly", "professional", "concise"] as const;
type ToneChoice = (typeof PRESET_TONES)[number] | "custom";

const FEATURE_ORDER: AIFeature[] = ["summarize", "rewrite", "translate", "triage", "copilot", "draft_reply", "answer", "kb_draft"];

const DEFAULTS: AISettings = {
  enabled: true,
  auto_triage: false,
  auto_summarize: false,
  widget_answers: false,
  tone: "friendly",
  reply_language: "customer",
  instructions: "",
};

const TONE_MAX = 200;
const INSTRUCTIONS_MAX = 2000;

function toneChoice(tone: string): ToneChoice {
  return (PRESET_TONES as readonly string[]).includes(tone) ? (tone as ToneChoice) : "custom";
}

export default function AiSettings() {
  const { t } = useTranslation("ai");
  const { data: config, isLoading } = useQuery(q.aiConfig());
  const role = useRole();
  const qc = useQueryClient();
  const available = !!config?.enabled;
  const canEdit = atLeast(role, "admin") && available;

  const base = config?.features ?? DEFAULTS;
  const [draft, setDraft] = useState<AISettings>(base);
  const [custom, setCustom] = useState(toneChoice(base.tone) === "custom");
  useEffect(() => {
    if (config?.features) {
      setDraft(config.features);
      setCustom(toneChoice(config.features.tone) === "custom");
    }
  }, [config?.features]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const toneTooLong = draft.tone.length > TONE_MAX;
  const instructionsTooLong = draft.instructions.length > INSTRUCTIONS_MAX;
  const invalid = toneTooLong || instructionsTooLong || (custom && !draft.tone.trim());

  const save = useMutation({
    mutationFn: (d: AISettings) => {
      const patch: Partial<AISettings> = {};
      for (const k of Object.keys(d) as (keyof AISettings)[]) if (d[k] !== base[k]) (patch as Record<string, unknown>)[k] = d[k];
      return api.ai.updateSettings(patch);
    },
    onSuccess: (features) => {
      qc.setQueryData<AIConfig | null>(qk.aiConfig, (old) => (old ? { ...old, features } : old));
      toast.success(t("settings.saved"));
    },
    onError: (e) => toast.error(errorMessage(e, t("settings.save_failed"))),
  });

  const set = (patch: Partial<AISettings>) => setDraft((d) => ({ ...d, ...patch }));
  const off = !canEdit || !draft.enabled;

  return (
    <SettingsPage title={t("settings.title")} description={t("settings.description")}>
      <UnsavedGuard when={dirty && !save.isPending} />
      <div className="flex flex-col gap-8">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : !available ? (
          <NotConfigured />
        ) : (
          !atLeast(role, "admin") && <p className="-mt-3 text-[12.5px] text-fg-3">{t("settings.read_only")}</p>
        )}

        <Section>
          <Row label={t("settings.enabled")} description={t("settings.enabled_hint")}>
            <Switch checked={available && draft.enabled} disabled={!canEdit} onCheckedChange={(enabled) => set({ enabled })} aria-label={t("settings.enabled")} />
          </Row>
        </Section>

        <Section title={t("settings.automatic")} description={t("settings.automatic_hint")}>
          <FeatureRow
            label={t("settings.auto_triage")}
            description={t("settings.auto_triage_hint")}
            cost={config?.costs?.triage}
            checked={draft.auto_triage}
            disabled={off}
            onChange={(auto_triage) => set({ auto_triage })}
          />
          <FeatureRow
            label={t("settings.auto_summarize")}
            description={t("settings.auto_summarize_hint")}
            cost={config?.costs?.summarize}
            checked={draft.auto_summarize}
            disabled={off}
            onChange={(auto_summarize) => set({ auto_summarize })}
          />
          <FeatureRow
            label={t("settings.widget_answers")}
            description={t("settings.widget_answers_hint")}
            cost={config?.costs?.answer}
            checked={draft.widget_answers}
            disabled={off}
            onChange={(widget_answers) => set({ widget_answers })}
          />
        </Section>

        <Section title={t("settings.writing")} description={t("settings.writing_hint")}>
          <Row label={t("settings.tone")} description={t("settings.tone_hint")} stack>
            <div className={cn("flex flex-col items-start gap-2", off && "pointer-events-none opacity-60")} aria-disabled={off || undefined}>
              <Segmented<ToneChoice>
                value={custom ? "custom" : toneChoice(draft.tone)}
                onChange={(v) => {
                  if (v === "custom") {
                    setCustom(true);
                    set({ tone: toneChoice(base.tone) === "custom" ? base.tone : "" });
                  } else {
                    setCustom(false);
                    set({ tone: v });
                  }
                }}
                options={[
                  { value: "friendly", label: t("tone.friendly") },
                  { value: "professional", label: t("tone.professional") },
                  { value: "concise", label: t("tone.concise") },
                  { value: "custom", label: t("tone.custom") },
                ]}
              />
              {custom && (
                <div className="flex w-full flex-col gap-1">
                  <TextInput
                    value={draft.tone}
                    autoFocus
                    disabled={off}
                    invalid={toneTooLong || !draft.tone.trim()}
                    aria-label={t("settings.custom_tone")}
                    placeholder={t("settings.custom_tone_placeholder")}
                    onChange={(e) => set({ tone: e.target.value })}
                  />
                  <Counter n={draft.tone.length} max={TONE_MAX} />
                </div>
              )}
            </div>
          </Row>
          <Row label={t("settings.reply_language")} description={t("settings.reply_language_hint")}>
            <div className={cn(off && "pointer-events-none opacity-60")} aria-disabled={off || undefined}>
              <Segmented<AISettings["reply_language"]>
                value={draft.reply_language}
                onChange={(reply_language) => set({ reply_language })}
                options={[
                  { value: "customer", label: t("settings.reply_customer") },
                  { value: "workspace", label: t("settings.reply_workspace") },
                ]}
              />
            </div>
          </Row>
          <Row label={t("settings.instructions")} description={t("settings.instructions_hint")} stack>
            <div className="flex flex-col gap-1">
              <Textarea
                value={draft.instructions}
                disabled={off}
                invalid={instructionsTooLong}
                rows={5}
                aria-label={t("settings.instructions")}
                placeholder={t("settings.instructions_placeholder")}
                onChange={(e) => set({ instructions: e.target.value })}
              />
              <Counter n={draft.instructions.length} max={INSTRUCTIONS_MAX} />
            </div>
          </Row>
        </Section>

        {available && config && (
          <Section title={t("settings.model")}>
            <Row label={t("settings.provider")}>
              <span className="mono text-[12px] text-fg-2">{config.provider}</span>
            </Row>
            <Row label={t("settings.models")} description={t("settings.models_hint")}>
              <span className="mono flex flex-col items-end gap-0.5 text-[12px] text-fg-2">
                <span>{config.models.default}</span>
                <span className="text-fg-3">{config.models.fast}</span>
              </span>
            </Row>
            <Row label={t("settings.search")} description={config.embeddings ? t("settings.embeddings_on") : t("settings.embeddings_off")}>
              <span className="flex items-center gap-2 text-[12.5px] text-fg-2">
                <span className={cn("size-1.5 rounded-full", config.embeddings ? "bg-ok" : "bg-fg-4")} aria-hidden />
                {config.embeddings ? t("settings.semantic") : t("settings.keyword")}
              </span>
            </Row>
          </Section>
        )}

        {available && config && Object.keys(config.costs).length > 0 && (
          <Section
            title={t("settings.costs")}
            description={t("settings.costs_hint")}
            actions={
              <Link to="/settings/billing" className="inline-flex items-center gap-1 text-[12.5px] text-fg-2 hover:text-fg">
                {t("settings.billing_link")}
                <ArrowUpRight className="size-3.5" />
              </Link>
            }
            flush
          >
            <table className="w-full text-[12.5px]">
              <tbody>
                {FEATURE_ORDER.filter((f) => config.costs[f] !== undefined).map((f) => (
                  <tr key={f} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2.5 text-fg-2">{t(`features.${f}`)}</td>
                    <td className="mono px-4 py-2.5 text-right tabular-nums text-fg">{config.costs[f]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}
      </div>

      <SaveBar
        dirty={dirty && canEdit}
        saving={save.isPending}
        disabled={invalid}
        onSave={() => save.mutate({ ...draft, tone: draft.tone.trim() })}
        onDiscard={() => {
          setDraft(base);
          setCustom(toneChoice(base.tone) === "custom");
        }}
      />
    </SettingsPage>
  );
}

function FeatureRow({
  label,
  description,
  cost,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  cost: number | undefined;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Row
      label={label}
      description={
        <>
          {description}
          {cost !== undefined && <span className="mono ml-1.5 text-[11px] text-fg-4">{t("credits", { count: cost })}</span>}
        </>
      }
    >
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={label} />
    </Row>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span className={cn("mono self-end text-[11px] tabular-nums", n > max ? "text-danger-fg" : "text-fg-4")}>
      {n.toLocaleString()} / {max.toLocaleString()}
    </span>
  );
}

function NotConfigured() {
  const { t } = useTranslation("ai");
  return (
    <div className="flex gap-3.5 rounded-lg border border-line bg-surface px-4 py-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-sunken text-fg-2">
        <AiIcon className="size-4" />
      </span>
      <div className="min-w-0 text-[12.5px] leading-5">
        <p className="text-[13px] font-medium text-fg">{t("settings.not_configured")}</p>
        <p className="mt-1 text-fg-3">
          <Trans
            t={t}
            i18nKey="settings.not_configured_hint"
            components={{ code: <code className="mono rounded bg-sunken px-1 py-px text-[11.5px] text-fg-2" /> }}
          />
        </p>
        <a
          href="https://docs.opendesk.sh/self-hosting/ai"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg"
        >
          {t("settings.docs_link")}
          <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
