import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, MessageSquareText, Paperclip, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { DropdownMenu as M } from "radix-ui";
import type { Attachment, Member, Message, SavedReply, Ticket, TicketStatus } from "@/lib/api/types";
import { api, type SendMessageBody } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import { q, qk } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { realtime } from "@/lib/realtime/manager";
import { bytes } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/tabs";
import { Picker } from "@/components/ui/picker";
import { Tooltip } from "@/components/ui/tooltip";
import { Avatar } from "@/components/ui/avatar";
import { Kbd } from "@/components/ui/kbd";
import { floatingPanel } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { RichEditor, type RichEditorHandle } from "@/components/editor/RichEditor";
import { mentionExtension, savedReplyExtension, SuggestionPopup } from "./suggestions";
import { StatusIcon, statusLabel } from "../bits";
import { useTicketViewers } from "../presence";
import { applyPatch } from "../useTicketActions";
import { patchTicketEverywhere } from "@/lib/ticketCache";
import { ComposerAiMenu, ComposerAiStatus, ComposerSources, useComposerAi } from "@/components/ai/ticket/ComposerAi";

type Mode = "reply" | "note";
type Upload = { key: string; file: File; status: "uploading" | "done" | "error"; attachment?: Attachment; preview?: string };
type Draft = { mode: Mode; html: string; cc: string[]; bcc: string[]; showCc: boolean };

// Drafts survive switching tickets (memory only).
const useDrafts = create<Record<string, Draft>>(() => ({}));
const emptyDraft: Draft = { mode: "reply", html: "", cc: [], bcc: [], showCc: false };

export type ComposerHandle = { focus: (mode?: Mode) => void; retry: (m: Message) => void; aiDraft: () => void };

const emailRe = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function EmailChips({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const commit = () => {
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    const ok = parts.filter((p) => emailRe.test(p) && !values.includes(p));
    if (ok.length) onChange([...values, ...ok]);
    setText(parts.filter((p) => !emailRe.test(p)).join(" "));
  };
  return (
    <div className="flex min-h-8 items-center gap-2 border-b border-line-soft px-3">
      <span className="w-7 shrink-0 text-xs text-fg-3">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
        {values.map((v) => (
          <span key={v} className="mono inline-flex h-5 items-center gap-1 rounded-[5px] bg-hover pl-1.5 pr-0.5 text-[11.5px]" data-ph-mask>
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="flex size-4 items-center justify-center rounded text-fg-4 hover:text-fg">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === "Tab") {
              if (text.trim()) {
                e.preventDefault();
                commit();
              }
            }
            if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
          }}
          aria-label={label}
          placeholder={values.length ? "" : "name@example.com"}
          className="h-6 min-w-[120px] flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-fg-4"
        />
      </div>
    </div>
  );
}

function useSend(ticket: Ticket) {
  const qc = useQueryClient();
  const user = useSession((s) => s.user!);
  return useMutation({
    mutationFn: (v: { body: SendMessageBody; tempId: string }) => api.tickets.send(ticket.id, v.body),
    onMutate: ({ body, tempId }) => {
      const now = new Date().toISOString();
      const temp: Message = {
        id: tempId,
        ticket_id: ticket.id,
        ai: false,
        kind: body.kind,
        direction: "outbound",
        author: { type: "user", user: { id: user.id, name: user.name, email: user.email, avatar_url: user.avatar_url }, contact: null },
        body_html: body.body_html,
        body_text: "",
        has_quoted: false,
        subject: ticket.subject,
        from_email: "",
        from_name: user.name,
        to: body.kind === "reply" && ticket.contact?.email ? [ticket.contact.email] : [],
        cc: body.cc ?? [],
        bcc: body.bcc ?? [],
        attachments: [],
        delivery_status: body.kind === "reply" ? "pending" : "none",
        delivery_error: "",
        created_at: now,
      };
      qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) => [...(old ?? []), temp]);
      const prevTicket = qc.getQueryData<Ticket>(qk.ticket(ticket.id));
      if (body.status && prevTicket) patchTicketEverywhere(qc, applyPatch(qc, prevTicket, { status: body.status }), user.id);
      return { prevTicket };
    },
    onSuccess: (m, { tempId }) => {
      qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) => {
        const rest = (old ?? []).filter((x) => x.id !== tempId && x.id !== m.id);
        return [...rest, m].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      });
    },
    onError: (e, { tempId }, ctx) => {
      qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) =>
        old?.map((x) => (x.id === tempId ? { ...x, delivery_status: "failed", delivery_error: errorMessage(e, "Not sent") } : x)),
      );
      if (ctx?.prevTicket) patchTicketEverywhere(qc, ctx.prevTicket, user.id);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.counts }),
  });
}

export const Composer = forwardRef<ComposerHandle, { ticket: Ticket; disabled?: boolean }>(function Composer({ ticket, disabled }, ref) {
  const draft = useDrafts((s) => s[ticket.id]) ?? emptyDraft;
  const setDraft = useCallback((p: Partial<Draft>) => useDrafts.setState((s) => ({ [ticket.id]: { ...(s[ticket.id] ?? emptyDraft), ...p } })), [ticket.id]);
  const { mode } = draft;

  const { data: members } = useQuery(q.members());
  const { data: replies } = useQuery(q.savedReplies());
  const qc = useQueryClient();
  const viewers = useTicketViewers(ticket.id);
  const others = viewers.filter((v) => v.state === "replying");

  const editor = useRef<RichEditorHandle>(null);
  const membersRef = useRef<Member[]>([]);
  const repliesRef = useRef<SavedReply[]>([]);
  const modeRef = useRef<Mode>(mode);
  membersRef.current = members ?? [];
  repliesRef.current = replies ?? [];
  modeRef.current = mode;
  const extensions = useMemo(
    () => [mentionExtension(() => membersRef.current, () => modeRef.current === "note"), savedReplyExtension(() => repliesRef.current)],
    [],
  );

  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const send = useSend(ticket);
  const retries = useRef(new Map<string, SendMessageBody>());
  const ai = useComposerAi(editor, ticket, mode);

  useImperativeHandle(ref, () => ({
    focus: (m) => {
      if (m) setDraft({ mode: m });
      setTimeout(() => editor.current?.focus(), 0);
    },
    // A failed send: a local one is replaced, a bounced one is sent again as a new message.
    retry: (m) => {
      const body = retries.current.get(m.id) ?? { kind: m.kind, body_html: m.body_html, cc: m.cc.length ? m.cc : undefined, bcc: m.bcc.length ? m.bcc : undefined };
      if (m.id.startsWith("tmp-")) qc.setQueryData<Message[]>(qk.messages(ticket.id), (old) => old?.filter((x) => x.id !== m.id));
      const tempId = `tmp-${Date.now().toString(36)}`;
      retries.current.set(tempId, body);
      send.mutate({ body, tempId });
    },
    aiDraft: () => {
      if (!ai.available || disabled) return;
      if (mode !== "reply") setDraft({ mode: "reply" });
      ai.draft();
    },
  }));

  // Presence: "replying" while a draft exists, "viewing" otherwise.
  const hasDraft = !!draft.html;
  useEffect(() => {
    realtime()?.setPresenceState(hasDraft && mode === "reply" ? "replying" : "viewing");
  }, [hasDraft, mode]);

  const upload = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 25 MB`);
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setUploads((u) => [...u, { key, file, status: "uploading", preview }]);
      api.attachments
        .upload(file)
        .then((attachment) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "done", attachment } : x))))
        .catch((e) => {
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "error" } : x)));
          toast.error(e, `Couldn't upload ${file.name}`);
        });
    }
  };

  const busyUploads = uploads.some((u) => u.status === "uploading");
  const canSend = !!draft.html && !busyUploads && !disabled && !ai.busy;

  const submit = (status?: TicketStatus) => {
    if (!canSend) return;
    const body: SendMessageBody = {
      kind: mode,
      body_html: draft.html,
      cc: mode === "reply" && draft.cc.length ? draft.cc : undefined,
      bcc: mode === "reply" && draft.bcc.length ? draft.bcc : undefined,
      attachment_ids: uploads.filter((u) => u.attachment).map((u) => u.attachment!.id),
      status,
    };
    const tempId = `tmp-${Date.now().toString(36)}`;
    retries.current.set(tempId, body);
    send.mutate({ body, tempId });
    uploads.forEach((u) => u.preview && URL.revokeObjectURL(u.preview));
    setUploads([]);
    setDraft({ html: "", cc: [], bcc: [], showCc: false });
    editor.current?.clear();
    ai.dismissSources();
    if (status) toast.success(`${mode === "note" ? "Note added" : "Reply sent"} and marked ${statusLabel[status].toLowerCase()}`);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (ticket.channel === "chat" && mode === "reply") realtime()?.typing(ticket.contact?.id);
    else realtime()?.typing();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault();
      submit("solved");
      return true;
    }
    return false;
  };

  const note = mode === "note";
  const recipient = ticket.contact?.email ?? ticket.contact?.name ?? "the customer";

  return (
    <div className="shrink-0 px-5 pb-4">
      <div className="mx-auto w-full max-w-[820px]">
        {others.length > 0 && mode === "reply" && (
          <div role="status" className="mb-2 flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] text-fg-2 animate-pop-in">
            <span className="size-1.5 shrink-0 rounded-full bg-warn" />
            <Avatar name={others[0].name} src={others[0].avatar} size="xs" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium text-fg">{others.map((o) => o.name.split(" ")[0]).join(", ")}</span> {others.length > 1 ? "are" : "is"} replying to this ticket right now.
            </span>
            <button type="button" onClick={() => setDraft({ mode: "note" })} className="shrink-0 text-xs text-fg-3 underline-offset-2 hover:text-fg hover:underline">
              Leave a note instead
            </button>
          </div>
        )}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              upload(files);
            }
          }}
          className={cn(
            "relative rounded-[10px] border shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-fg-4 focus-within:shadow-[0_0_0_3px_var(--focus)]",
            note ? "border-dashed border-note-line bg-note" : "border-line bg-surface",
          )}
        >
          <div className="flex h-10 items-center gap-2 border-b border-line-soft px-2">
            <Segmented
              size="xs"
              value={mode}
              onChange={(m) => setDraft({ mode: m })}
              options={[
                { value: "reply", label: "Reply" },
                { value: "note", label: "Note" },
              ]}
            />
            {note ? (
              <span className="truncate text-xs text-fg-3">Only your team sees notes. Type @ to mention someone.</span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-xs text-fg-3">
                To <span className="mono text-fg-2" data-ph-mask>{recipient}</span>
              </span>
            )}
            {!note && (
              <button
                type="button"
                onClick={() => setDraft({ showCc: !draft.showCc })}
                aria-expanded={draft.showCc}
                className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs text-fg-3 hover:bg-hover hover:text-fg", draft.showCc && "text-fg")}
              >
                Cc / Bcc
              </button>
            )}
          </div>
          {!note && draft.showCc && (
            <>
              <EmailChips label="Cc" values={draft.cc} onChange={(cc) => setDraft({ cc })} />
              <EmailChips label="Bcc" values={draft.bcc} onChange={(bcc) => setDraft({ bcc })} />
            </>
          )}
          <RichEditor
            ref={editor}
            value={draft.html}
            onChange={(html) => setDraft({ html })}
            placeholder={note ? "Write a note for your team" : "Write a reply. Type / for saved replies."}
            extensions={extensions}
            onSubmit={() => submit()}
            onKeyDown={onKeyDown}
            editable={!disabled && !ai.busy}
            contentClassName="min-h-[84px] max-h-[40vh]"
            ariaLabel={note ? "Note" : "Reply"}
            toolbarEnd={
              <>
                <ComposerAiMenu ai={ai} hasDraft={!!draft.html} disabled={disabled} />
                <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
                <Tooltip content="Attach files">
                  <button
                    type="button"
                    aria-label="Attach files"
                    onClick={() => fileInput.current?.click()}
                    className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                  >
                    <Paperclip className="size-[15px]" />
                  </button>
                </Tooltip>
                <Picker
                  side="top"
                  align="end"
                  width={300}
                  placeholder="Search saved replies"
                  emptyText="No saved replies"
                  value={null}
                  items={(replies ?? []).map((r) => ({ value: r.id, label: r.title, hint: r.shortcut ? `/${r.shortcut.replace(/^\//, "")}` : undefined }))}
                  onSelect={(id) => {
                    const r = replies?.find((x) => x.id === id);
                    if (r) editor.current?.insertHtml(r.body_html);
                  }}
                  trigger={
                    <Tooltip content="Saved replies">
                      <button type="button" aria-label="Saved replies" className="flex size-7 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg">
                        <MessageSquareText className="size-[15px]" />
                      </button>
                    </Tooltip>
                  }
                />
                <span className="mx-1 h-4 w-px bg-line" />
                <SendButton note={note} disabled={!canSend} busy={busyUploads} onSend={submit} current={ticket.status} />
              </>
            }
          />
          <ComposerSources ai={ai} />
          <ComposerAiStatus ai={ai} />
          {uploads.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
              {uploads.map((u) => (
                <span key={u.key} className={cn("flex h-8 max-w-[220px] items-center gap-2 rounded-md border bg-surface pl-1 pr-1", u.status === "error" ? "border-[color-mix(in_srgb,var(--danger)_40%,var(--line))]" : "border-line")}>
                  {u.preview ? <img src={u.preview} alt="" className="size-6 rounded-[4px] object-cover" /> : <span className="flex size-6 items-center justify-center rounded-[4px] bg-hover"><Paperclip className="size-3 text-fg-3" /></span>}
                  <span className="min-w-0">
                    <span className="block truncate text-[11.5px]">{u.file.name}</span>
                    <span className="mono block text-[10px] text-fg-4">{u.status === "uploading" ? "Uploading" : u.status === "error" ? "Failed" : bytes(u.file.size)}</span>
                  </span>
                  {u.status === "uploading" ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-fg-4" />
                  ) : (
                    <button type="button" aria-label={`Remove ${u.file.name}`} onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))} className="flex size-5 shrink-0 items-center justify-center rounded text-fg-4 hover:bg-hover hover:text-fg">
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {dragging && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[10px] border-2 border-dashed border-fg-3 bg-surface/90 text-[13px] font-medium text-fg-2">
              Drop files to attach
            </div>
          )}
        </div>
        <SuggestionPopup />
      </div>
    </div>
  );
});

function SendButton({ note, disabled, busy, onSend, current }: { note: boolean; disabled: boolean; busy: boolean; onSend: (s?: TicketStatus) => void; current: TicketStatus }) {
  const label = note ? "Add note" : "Send";
  const options: TicketStatus[] = (["pending", "on_hold", "solved"] as TicketStatus[]).filter((s) => s !== current);
  return (
    <div className="flex items-center">
      <Tooltip content={busy ? "Waiting for uploads" : note ? "Add note" : "Send reply"} shortcut="mod enter">
        <Button variant="primary" size="sm" disabled={disabled} onClick={() => onSend()} className="rounded-r-none">
          {label}
        </Button>
      </Tooltip>
      <M.Root>
        <M.Trigger asChild disabled={disabled}>
          <Button variant="primary" size="sm" square aria-label={`${label} and set status`} className="rounded-l-none border-l border-white/15 dark:border-black/15" icon={<ChevronDown className="size-3.5" />} />
        </M.Trigger>
        <M.Portal>
          <M.Content side="top" align="end" sideOffset={6} className={cn(floatingPanel, "w-[230px] p-1")}>
            <div className="label-caps px-2 pb-1 pt-1.5">{label} and set status</div>
            {options.map((s) => (
              <M.Item key={s} onSelect={() => onSend(s)} className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-[12.5px] outline-none data-[highlighted]:bg-hover">
                <StatusIcon status={s} />
                <span className="flex-1">
                  {label} and mark {statusLabel[s].toLowerCase()}
                </span>
                {s === "solved" && <Kbd>mod shift enter</Kbd>}
              </M.Item>
            ))}
          </M.Content>
        </M.Portal>
      </M.Root>
    </div>
  );
}
