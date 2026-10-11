// AI in the reply composer: draft a reply (streamed), rewrite the draft or the
// selection, translate the draft into the customer's language. Every change is
// undoable; credits are shown in the menu, never as colour.

import { useQueryClient } from "@tanstack/react-query";
import { DropdownMenu as M, Popover as P } from "radix-ui";
import { BookOpen, Languages, PenLine, Square, X } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { AIFeature, KBSource, RewriteMode, Ticket } from "@/lib/api/types";
import { api } from "@/lib/api/endpoints";
import { useAI } from "@/lib/ai";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { floatingPanel } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import type { RichEditorHandle } from "@/components/editor/RichEditor";
import { AiIcon, useCreditLabel } from "../bits";
import { creditsSpent, isAbort, reportAiError } from "./errors";
import { isForeign, languageName, streamTextToHtml, ticketLanguage } from "./text";

export const REWRITE_MODES: RewriteMode[] = ["friendlier", "more_formal", "shorter", "longer", "fix_grammar", "simplify"];

type Busy = { kind: "draft" | "rewrite" | "translate"; selection?: boolean; preview?: string } | null;

export type ComposerAi = {
  available: boolean;
  busy: Busy;
  sources: KBSource[];
  dismissSources: () => void;
  draft: (instructions?: string) => void;
  rewrite: (mode: RewriteMode) => void;
  translate: () => void;
  stop: () => void;
  /** Customer language to translate into, when it differs from ours. */
  target: string | null;
};

function currentHtml(ed: RichEditorHandle | null): string {
  if (!ed?.editor || ed.isEmpty()) return "";
  return ed.editor.getHTML();
}

export function useComposerAi(editor: RefObject<RichEditorHandle | null>, ticket: Ticket, mode: "reply" | "note"): ComposerAi {
  const { t } = useTranslation("aiTicket");
  const ai = useAI();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<Busy>(null);
  const [sources, setSources] = useState<KBSource[]>([]);
  const abort = useRef<AbortController | null>(null);
  const lang = ticketLanguage(ticket);
  const target = mode === "reply" && lang && isForeign(lang) ? lang : null;

  const restore = useCallback(
    (html: string) => {
      editor.current?.setHtml(html);
      setTimeout(() => editor.current?.focus(), 0);
    },
    [editor],
  );

  const undoToast = (message: string, prev: string) =>
    toast.info(message, { action: { label: t("undo"), onClick: () => restore(prev) } });

  const runDraft = async (instructions: string | undefined, prev: string) => {
    const ac = new AbortController();
    abort.current = ac;
    setBusy({ kind: "draft" });
    setSources([]);
    try {
      const res = await api.ai.draft(
        ticket.id,
        { instructions: instructions?.trim() || undefined },
        { signal: ac.signal, onDelta: (_d, soFar) => editor.current?.setHtml(streamTextToHtml(soFar)) },
      );
      editor.current?.setHtml(res.body_html);
      setSources(res.sources ?? []);
      creditsSpent(qc);
      if (prev) undoToast(t("composer.draftReplaced"), prev);
    } catch (e) {
      if (isAbort(e)) return;
      restore(prev);
      reportAiError(e, t("composer.draftFailed"));
    } finally {
      abort.current = null;
      setBusy(null);
      setTimeout(() => editor.current?.focus(), 0);
    }
  };

  const draft = (instructions?: string) => {
    if (busy) return;
    const prev = currentHtml(editor.current);
    if (prev) {
      confirm.show(t("composer.replaceBody"), () => void runDraft(instructions, prev), {
        title: t("composer.replaceTitle"),
        confirmLabel: t("composer.replaceConfirm"),
      });
      return;
    }
    void runDraft(instructions, prev);
  };

  const rewrite = async (m: RewriteMode) => {
    const ed = editor.current?.editor;
    if (busy || !ed || ed.isEmpty) return;
    const prev = ed.getHTML();
    const { from, to, empty } = ed.state.selection;
    const selection = !empty && to - from > 1;
    const html = selection ? streamTextToHtml(ed.state.doc.textBetween(from, to, "\n\n")) : prev;
    const ac = new AbortController();
    abort.current = ac;
    setBusy({ kind: "rewrite", selection });
    try {
      const res = await api.ai.rewrite(
        { html, mode: m },
        {
          signal: ac.signal,
          onDelta: (_d, soFar) => {
            if (selection) setBusy({ kind: "rewrite", selection, preview: soFar });
            else editor.current?.setHtml(streamTextToHtml(soFar));
          },
        },
      );
      if (selection) ed.chain().focus().insertContentAt({ from, to }, res.html).run();
      else editor.current?.setHtml(res.html);
      creditsSpent(qc);
      undoToast(t(selection ? "composer.rewroteSelection" : "composer.rewrote", { mode: t(`rewrite.${m}`).toLowerCase() }), prev);
    } catch (e) {
      if (!isAbort(e)) {
        restore(prev);
        reportAiError(e, t("composer.rewriteFailed"));
      } else if (!selection) restore(prev);
    } finally {
      abort.current = null;
      setBusy(null);
    }
  };

  const translate = async () => {
    const prev = currentHtml(editor.current);
    if (busy || !prev || !target) return;
    setBusy({ kind: "translate" });
    try {
      const res = await api.ai.translate({ html: prev, target });
      editor.current?.setHtml(res.html ?? streamTextToHtml(res.text ?? ""));
      creditsSpent(qc);
      undoToast(t("composer.translated", { language: languageName(target) }), prev);
    } catch (e) {
      reportAiError(e, t("composer.translateFailed"));
    } finally {
      setBusy(null);
    }
  };

  return {
    available: ai.enabled,
    busy,
    sources,
    dismissSources: () => setSources([]),
    draft,
    rewrite: (m) => void rewrite(m),
    translate: () => void translate(),
    stop: () => abort.current?.abort(),
    target,
  };
}

const itemCls =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[12.5px] text-fg outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-3";

function Item({ icon, children, hint, onSelect, disabled }: { icon?: ReactNode; children: ReactNode; hint?: ReactNode; onSelect: () => void; disabled?: boolean }) {
  return (
    <M.Item className={itemCls} onSelect={onSelect} disabled={disabled}>
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {hint}
    </M.Item>
  );
}

function Cost({ feature }: { feature: AIFeature }) {
  const label = useCreditLabel()(feature);
  return label ? <span className="mono text-[10.5px] normal-case tracking-normal text-fg-4">{label}</span> : null;
}

/** The sparkle menu in the composer toolbar. */
export function ComposerAiMenu({ ai, hasDraft, disabled }: { ai: ComposerAi; hasDraft: boolean; disabled?: boolean }) {
  const { t } = useTranslation("aiTicket");
  const [guideOpen, setGuideOpen] = useState(false);
  const [guide, setGuide] = useState("");
  if (!ai.available) return null;

  const submitGuide = () => {
    setGuideOpen(false);
    ai.draft(guide);
  };

  return (
    <P.Root open={guideOpen} onOpenChange={setGuideOpen}>
      <P.Anchor asChild>
        <span className="inline-flex">
          <M.Root>
            <Tooltip content={t("composer.menuLabel")} shortcut="mod j">
              <M.Trigger asChild disabled={disabled || !!ai.busy}>
                <button
                  type="button"
                  aria-label={t("composer.menuLabel")}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-fg-3 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 data-[state=open]:bg-hover data-[state=open]:text-fg"
                >
                  <AiIcon />
                  <span className="hidden sm:inline">{t("composer.menuShort")}</span>
                </button>
              </M.Trigger>
            </Tooltip>
            <M.Portal>
              <M.Content side="top" align="end" sideOffset={6} collisionPadding={8} className={cn(floatingPanel, "w-[248px] p-1")}>
                <Item icon={<AiIcon />} onSelect={() => ai.draft()} hint={<Kbd>mod j</Kbd>}>
                  {t("composer.draft")}
                </Item>
                <Item icon={<PenLine />} onSelect={() => setTimeout(() => setGuideOpen(true), 0)} hint={<Cost feature="draft_reply" />}>
                  {t("composer.draftWithGuide")}
                </Item>
                <M.Separator className="-mx-1 my-1 h-px bg-line" />
                <M.Label className="label-caps flex items-center justify-between px-2 pb-1 pt-1.5">
                  <span>{t("composer.rewriteLabel")}</span>
                  <Cost feature="rewrite" />
                </M.Label>
                {REWRITE_MODES.map((m) => (
                  <Item key={m} onSelect={() => ai.rewrite(m)} disabled={!hasDraft}>
                    {t(`rewrite.${m}`)}
                  </Item>
                ))}
                {ai.target && (
                  <>
                    <M.Separator className="-mx-1 my-1 h-px bg-line" />
                    <Item icon={<Languages />} onSelect={ai.translate} disabled={!hasDraft} hint={<Cost feature="translate" />}>
                      {t("composer.translateTo", { language: languageName(ai.target) })}
                    </Item>
                  </>
                )}
              </M.Content>
            </M.Portal>
          </M.Root>
        </span>
      </P.Anchor>
      <P.Portal>
        <P.Content side="top" align="end" sideOffset={6} collisionPadding={8} className={cn(floatingPanel, "w-[320px] p-3")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitGuide();
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="ai-guide" className="flex items-center gap-1.5 text-[12px] font-medium">
          <AiIcon className="text-fg-3" /> {t("composer.guideTitle")}
        </label>
        <Textarea
          id="ai-guide"
          autoFocus
          rows={3}
          value={guide}
          onChange={(e) => setGuide(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submitGuide();
            }
          }}
          placeholder={t("composer.guidePlaceholder")}
          className="text-[12.5px]"
        />
        <div className="flex items-center justify-between">
          <Cost feature="draft_reply" />
          <Button type="submit" size="sm" variant="primary">
            {t("composer.draft")}
          </Button>
        </div>
      </form>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** A thin, calm progress row shown while AI writes into the composer. */
export function ComposerAiStatus({ ai }: { ai: ComposerAi }) {
  const { t } = useTranslation("aiTicket");
  if (!ai.busy) return null;
  const label =
    ai.busy.kind === "draft" ? t("composer.drafting") : ai.busy.kind === "translate" ? t("composer.translating") : ai.busy.selection ? t("composer.rewritingSelection") : t("composer.rewriting");
  return (
    <div className="relative border-t border-line-soft">
      <div className="absolute inset-x-0 -top-px h-px overflow-hidden" aria-hidden>
        <div className="h-full w-1/3 bg-fg-3" style={{ animation: "pending-bar 1.4s ease-in-out infinite" }} />
      </div>
      <div role="status" aria-live="polite" className="flex h-9 items-center gap-2 px-3 text-[12px] text-fg-3">
        <AiIcon className="animate-pulse-soft" />
        <span className="shrink-0">{label}</span>
        {ai.busy.preview && <span className="min-w-0 flex-1 truncate text-fg-4" data-ph-mask>{ai.busy.preview}</span>}
        {ai.busy.kind !== "translate" && (
          <Button size="xs" variant="ghost" className="ml-auto" icon={<Square className="size-2.5 fill-current" />} onClick={ai.stop}>
            {t("composer.stop")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Knowledge base articles a draft was based on. */
export function ComposerSources({ ai }: { ai: ComposerAi }) {
  const { t } = useTranslation("aiTicket");
  if (!ai.sources.length || ai.busy) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 animate-fade-in">
      <span className="text-[11px] text-fg-4">{t("composer.basedOn")}</span>
      {ai.sources.map((s) => (
        <a
          key={s.article_id}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-5 max-w-[220px] items-center gap-1 rounded-sm border border-line bg-surface px-1.5 text-[11px] text-fg-2 hover:border-line-strong hover:text-fg"
        >
          <BookOpen className="size-3 shrink-0 text-fg-4" />
          <span className="truncate">{s.title}</span>
        </a>
      ))}
      <Tooltip content={t("composer.hideSources")}>
        <button type="button" aria-label={t("composer.hideSources")} onClick={ai.dismissSources} className="flex size-5 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-fg">
          <X className="size-3" />
        </button>
      </Tooltip>
    </div>
  );
}
