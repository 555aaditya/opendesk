// Knowledge sources (contracts/agent.md): the kind and status vocabulary, and
// the dialogs that add or edit a website, a file or a Q&A snippet.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, FileUp, Globe, MessageSquareQuote, Upload, X } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea, TextInput } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { Stepper } from "@/components/settings2/Stepper";
import { ChipEditor } from "./ChipEditor";
import { Counter } from "./bits";
import { api } from "@/lib/api/endpoints";
import type { KnowledgeKind, KnowledgeSource, KnowledgeStatus } from "@/lib/api/types";
import { bytes } from "@/lib/format";
import { qk } from "@/lib/queries";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/tones";

export const KIND_ICON: Record<KnowledgeKind, typeof Globe> = { website: Globe, file: FileText, snippet: MessageSquareQuote };
export const KIND_TONE: Record<KnowledgeKind, Tone> = { website: "teal", file: "blue", snippet: "amber" };
export const STATUS_TONE: Record<KnowledgeStatus, Tone> = { pending: "gray", syncing: "violet", ready: "green", error: "red" };

export const FILE_MAX = 20 * 1024 * 1024;
export const FILE_ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv";
const FILE_EXT = /\.(pdf|docx|txt|md|markdown|html?|csv)$/i;
const PATHS_MAX = 20;
const NAME_MAX = 100;

/** The line under a source's name: its address, file or question. */
export function sourceDetail(s: KnowledgeSource): string {
  if (s.kind === "website") return s.website?.url ?? "";
  if (s.kind === "file") return s.file ? `${s.file.filename} · ${bytes(s.file.size_bytes)}` : "";
  return s.snippet?.question ?? "";
}

/** Puts a created or edited source at the top of the list cache. */
function useStore() {
  const qc = useQueryClient();
  return (s: KnowledgeSource) =>
    qc.setQueryData<KnowledgeSource[]>(qk.knowledge, (rows) => (rows ? [s, ...rows.filter((r) => r.id !== s.id)] : [s]));
}

/** "example.com/docs" → "https://example.com/docs"; null when it can't be a web address. */
function normalizeUrl(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** "/docs/" stays, "docs" becomes "/docs"; null with spaces or a full address. */
function normalizePath(v: string): string | null {
  const s = v.trim();
  if (!s || /\s/.test(s) || /^[a-z]+:\/\//i.test(s)) return null;
  return s.startsWith("/") ? s : `/${s}`;
}

function DialogFooter({ onCancel, submit, busy, disabled }: { onCancel: () => void; submit: ReactNode; busy: boolean; disabled?: boolean }) {
  const { t } = useTranslation("agent");
  return (
    <>
      <Button onClick={onCancel}>{t("cancel")}</Button>
      <Button variant="primary" type="submit" form="knowledge-form" loading={busy} disabled={disabled}>
        {submit}
      </Button>
    </>
  );
}

export function WebsiteDialog({ source, onClose, onSaved }: { source: KnowledgeSource | null; onClose: () => void; onSaved?: (s: KnowledgeSource) => void }) {
  const { t } = useTranslation("agent");
  const store = useStore();
  const w = source?.website;
  const [url, setUrl] = useState(w?.url ?? "");
  const [name, setName] = useState(source?.name ?? "");
  const [maxPages, setMaxPages] = useState(w?.max_pages ?? 100);
  const [include, setInclude] = useState<string[]>(w?.include ?? []);
  const [exclude, setExclude] = useState<string[]>(w?.exclude ?? []);
  const [weekly, setWeekly] = useState((w?.recrawl ?? "weekly") === "weekly");
  const [tried, setTried] = useState(false);
  const clean = normalizeUrl(url);
  const urlError = tried && !clean ? t("knowledge.website.urlInvalid") : null;

  const save = useMutation({
    mutationFn: () => {
      const website = { url: clean!, max_pages: maxPages, include, exclude, recrawl: weekly ? ("weekly" as const) : ("off" as const) };
      const n = name.trim() || undefined;
      return source ? api.ai.knowledge.update(source.id, { name: n, website }) : api.ai.knowledge.create({ kind: "website", name: n, website });
    },
    onSuccess: (s) => {
      store(s);
      toast.success(source ? t("knowledge.website.saved") : t("knowledge.website.added"));
      onSaved?.(s);
      onClose();
    },
    onError: (e) => toast.error(e, t("knowledge.saveError")),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={source ? t("knowledge.website.editTitle") : t("knowledge.website.title")}
      description={t("knowledge.website.description")}
      footer={<DialogFooter onCancel={onClose} busy={save.isPending} submit={source ? t("save") : t("knowledge.website.submit")} />}
    >
      <form
        id="knowledge-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (clean) save.mutate();
        }}
      >
        <Field label={t("knowledge.website.url")} hint={t("knowledge.website.urlHint")} error={urlError}>
          {(p) => (
            <TextInput
              {...p}
              data-autofocus
              autoFocus
              className="mono"
              inputMode="url"
              placeholder="https://help.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => url.trim() && setTried(true)}
            />
          )}
        </Field>
        <Field label={t("knowledge.name")} hint={t("knowledge.nameHint")} optional>
          {(p) => <TextInput {...p} value={name} maxLength={NAME_MAX} placeholder={clean ? new URL(clean).hostname : ""} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-fg">{t("knowledge.website.maxPages")}</div>
            <div className="text-xs text-fg-3">{t("knowledge.website.maxPagesHint")}</div>
          </div>
          <Stepper value={maxPages} onChange={setMaxPages} min={1} max={500} step={10} aria-label={t("knowledge.website.maxPages")} className="w-[130px]" />
        </div>
        <Field label={t("knowledge.website.include")} hint={t("knowledge.website.includeHint")}>
          {(p) => (
            <ChipEditor id={p.id} mono values={include} onChange={setInclude} max={PATHS_MAX} normalize={normalizePath} placeholder="/docs" aria-label={t("knowledge.website.include")} />
          )}
        </Field>
        <Field label={t("knowledge.website.exclude")} hint={t("knowledge.website.excludeHint")}>
          {(p) => (
            <ChipEditor id={p.id} mono values={exclude} onChange={setExclude} max={PATHS_MAX} normalize={normalizePath} placeholder="/blog" aria-label={t("knowledge.website.exclude")} />
          )}
        </Field>
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-line bg-sunken px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium text-fg">{t("knowledge.website.weekly")}</span>
            <span className="block text-xs text-fg-3">{t("knowledge.website.weeklyHint")}</span>
          </span>
          <Switch checked={weekly} onCheckedChange={setWeekly} aria-label={t("knowledge.website.weekly")} />
        </label>
      </form>
    </Dialog>
  );
}

export function SnippetDialog({ source, onClose }: { source: KnowledgeSource | null; onClose: () => void }) {
  const { t } = useTranslation("agent");
  const store = useStore();
  const [question, setQuestion] = useState(source?.snippet?.question ?? "");
  const [answer, setAnswer] = useState(source?.snippet?.answer ?? "");
  const [tried, setTried] = useState(false);
  const qLen = question.trim().length;
  const aLen = answer.trim().length;
  const qError = tried && (qLen < 3 || qLen > 300) ? t("knowledge.snippet.questionInvalid") : null;
  const aError = tried && (aLen < 1 || aLen > 4000) ? t("knowledge.snippet.answerInvalid") : null;

  const save = useMutation({
    mutationFn: () => {
      const snippet = { question: question.trim(), answer: answer.trim() };
      return source ? api.ai.knowledge.update(source.id, { name: snippet.question.slice(0, NAME_MAX), snippet }) : api.ai.knowledge.create({ kind: "snippet", snippet });
    },
    onSuccess: (s) => {
      store(s);
      toast.success(source ? t("knowledge.snippet.saved") : t("knowledge.snippet.added"));
      onClose();
    },
    onError: (e) => toast.error(e, t("knowledge.saveError")),
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={source ? t("knowledge.snippet.editTitle") : t("knowledge.snippet.title")}
      description={t("knowledge.snippet.description")}
      footer={<DialogFooter onCancel={onClose} busy={save.isPending} submit={source ? t("save") : t("knowledge.snippet.submit")} />}
    >
      <form
        id="knowledge-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (qLen >= 3 && qLen <= 300 && aLen >= 1 && aLen <= 4000) save.mutate();
        }}
      >
        <Field label={t("knowledge.snippet.question")} error={qError}>
          {(p) => (
            <TextInput {...p} autoFocus maxLength={320} placeholder={t("knowledge.snippet.questionPlaceholder")} value={question} onChange={(e) => setQuestion(e.target.value)} />
          )}
        </Field>
        <Field label={t("knowledge.snippet.answer")} error={aError} hint={t("knowledge.snippet.answerHint")}>
          {(p) => (
            <div className="flex flex-col gap-1">
              <Textarea {...p} rows={7} placeholder={t("knowledge.snippet.answerPlaceholder")} value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <Counter n={answer.length} max={4000} className="self-end" />
            </div>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Why a file can't be uploaded, or null. */
export function fileProblem(f: File, t: (k: "knowledge.file.tooBig" | "knowledge.file.wrongType") => string): string | null {
  if (!FILE_EXT.test(f.name)) return t("knowledge.file.wrongType");
  if (f.size > FILE_MAX) return t("knowledge.file.tooBig");
  return null;
}

export function FileDialog({ initial, onClose }: { initial?: File | null; onClose: () => void }) {
  const { t } = useTranslation("agent");
  const store = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(initial ?? null);
  const [name, setName] = useState("");
  const [over, setOver] = useState(false);
  const problem = file ? fileProblem(file, t) : null;

  const save = useMutation({
    mutationFn: () => api.ai.knowledge.upload(file!, name.trim() || undefined),
    onSuccess: (s) => {
      store(s);
      toast.success(t("knowledge.file.added"));
      onClose();
    },
    onError: (e) => toast.error(e, t("knowledge.file.error")),
  });

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="md"
      title={t("knowledge.file.title")}
      description={t("knowledge.file.description")}
      footer={<DialogFooter onCancel={onClose} busy={save.isPending} disabled={!file || !!problem} submit={t("knowledge.file.submit")} />}
    >
      <form
        id="knowledge-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (file && !problem) save.mutate();
        }}
      >
        <input
          ref={input}
          type="file"
          accept={FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFile(f);
            e.target.value = "";
          }}
        />
        {file ? (
          <div className={cn("flex items-center gap-3 rounded-lg border px-3 py-3", problem ? "border-[color-mix(in_srgb,var(--danger)_40%,var(--line))]" : "border-line bg-sunken")}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-tone-blue-soft text-tone-blue">
              <FileText className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-fg">{file.name}</div>
              <div className={cn("text-xs", problem ? "text-danger-fg" : "text-fg-3")} role={problem ? "alert" : undefined}>
                {problem ?? bytes(file.size)}
              </div>
            </div>
            <Button square size="xs" variant="ghost" aria-label={t("knowledge.file.remove")} onClick={() => setFile(null)}>
              <X />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-9 text-center outline-none transition-colors duration-150 focus-visible:shadow-[0_0_0_3px_var(--focus)]",
              over ? "border-tone-blue-line bg-tone-blue-soft" : "border-line-strong bg-sunken hover:bg-hover",
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-surface shadow-xs">
              {over ? <FileUp className="size-4 text-tone-blue" /> : <Upload className="size-4 text-fg-3" />}
            </span>
            <span className="text-[13px] font-medium text-fg">{over ? t("knowledge.file.dropNow") : t("knowledge.file.drop")}</span>
            <span className="text-xs text-fg-3">{t("knowledge.file.types")}</span>
          </button>
        )}
        <Field label={t("knowledge.name")} hint={t("knowledge.nameHint")} optional>
          {(p) => <TextInput {...p} value={name} maxLength={NAME_MAX} placeholder={file?.name ?? ""} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}
