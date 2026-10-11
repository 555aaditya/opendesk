import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, CircleCheck, Copy, GitMerge, MoreHorizontal, PanelRight, RotateCcw, ShieldAlert, ShieldCheck, Trash2, UserRound, X, MessageSquare, StickyNote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { q } from "@/lib/queries";
import { isApiError } from "@/lib/api/client";
import { realtime } from "@/lib/realtime/manager";
import { useHotkeys } from "@/lib/hotkeys";
import { useAI } from "@/lib/ai";
import { useTranslation } from "react-i18next";
import { AiIcon } from "@/components/ai/bits";
import { atLeast, useRole, useSession } from "@/lib/session";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/app/RootLayout";
import { usePageCommands } from "@/app/shellStore";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AvatarStack } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/components/ui/copy-button";
import { TicketNumber } from "../bits";
import { useTicketViewers } from "../presence";
import { useDeleteTicket, useUpdateTicket } from "../useTicketActions";
import { Timeline } from "./Timeline";
import { Composer, type ComposerHandle } from "./Composer";
import { TicketProperties } from "./TicketProperties";
import { MergeDialog } from "./MergeDialog";
import { SnoozeMenu } from "./SnoozeMenu";

const PANEL_KEY = "od-ticket-panel";
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function readPanel() {
  try {
    return localStorage.getItem(PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

function SubjectEditor({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (!editing || disabled)
    return (
      <h1
        className={cn("min-w-0 truncate text-[14px] font-semibold tracking-[-0.01em]", !disabled && "cursor-text rounded px-1 -mx-1 hover:bg-hover")}
        onClick={() => !disabled && setEditing(true)}
        title={disabled ? value : "Click to edit the subject"}
        data-ph-mask
      >
        {value || "(no subject)"}
      </h1>
    );
  const commit = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== value) onSave(text.trim());
    else setText(value);
  };
  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          e.stopPropagation();
          setText(value);
          setEditing(false);
        }
      }}
      aria-label="Subject"
      className="-mx-1 h-7 min-w-0 flex-1 rounded border border-line bg-surface px-1 text-[14px] font-semibold tracking-[-0.01em] outline-none focus:border-fg-4"
    />
  );
}

export default function TicketDetail({
  ticketId,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  ticketId: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
}) {
  // The URL may carry the uuid or the ticket number; messages need the uuid.
  const ticket = useQuery(q.ticket(ticketId));
  const realId = ticket.data?.id ?? (isUuid(ticketId) ? ticketId : "");
  const messages = useQuery({ ...q.messages(realId), enabled: !!realId });
  const activities = useQuery({ ...q.activities(realId), enabled: !!realId });
  const role = useRole();
  const canEdit = atLeast(role, "agent");
  const me = useSession((s) => s.user!.id);
  const viewers = useTicketViewers(realId || undefined);
  const update = useUpdateTicket();
  const del = useDeleteTicket();
  const confirm = useConfirm();
  const composer = useRef<ComposerHandle>(null);
  const aiOn = useAI().enabled;
  const { t: tAi } = useTranslation("aiTicket");
  const [assignOpen, setAssignOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [panel, setPanel] = useState(readPanel);
  const t = ticket.data;
  useDocumentTitle(t ? `#${t.number} ${t.subject}` : null);

  useEffect(() => {
    if (!realId) return;
    realtime()?.setActiveTicket(realId);
    return () => realtime()?.setActiveTicket(null);
  }, [realId]);

  const togglePanel = () => {
    setPanel((p) => {
      try {
        localStorage.setItem(PANEL_KEY, p ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !p;
    });
  };

  const solved = t?.status === "solved" || t?.status === "closed";
  const solve = () => {
    if (!t || !canEdit) return;
    update.mutate({ id: t.id, patch: { status: solved ? "open" : "solved" } });
    toast.success(solved ? `Reopened #${t.number}` : `Solved #${t.number}`, solved ? undefined : { action: { label: "Undo", onClick: () => update.mutate({ id: t.id, patch: { status: t.status } }) } });
    if (!solved && onNext) onNext();
  };
  const spam = () => {
    if (!t) return;
    update.mutate({ id: t.id, patch: { spam: !t.spam } });
    toast.success(t.spam ? "Moved out of spam" : "Marked as spam");
    if (!t.spam) onClose();
  };
  const remove = () =>
    t &&
    confirm.show(
      "The ticket and its conversation will be deleted for everyone in the workspace.",
      async () => {
        await del.mutateAsync(t.id);
        toast.success(`Deleted #${t.number}`);
        onClose();
      },
      { title: `Delete #${t.number}?`, confirmLabel: "Delete", danger: true },
    );
  const assignMe = () => t && update.mutate({ id: t.id, patch: { assignee_id: me } });

  useHotkeys(
    {
      r: () => composer.current?.focus("reply"),
      n: () => composer.current?.focus("note"),
      a: () => setAssignOpen(true),
      e: solve,
      i: () => assignMe(),
      "]": togglePanel,
      "mod+j": () => composer.current?.aiDraft(),
    },
    !!t && canEdit,
  );

  // Offer the ticket's actions in the command menu while it's open.
  useEffect(() => {
    if (!t || !canEdit) return;
    usePageCommands.setState({
      commands: [
        { id: "reply", label: "Reply", shortcut: "r", icon: <MessageSquare />, run: () => composer.current?.focus("reply") },
        { id: "note", label: "Add a note", shortcut: "n", icon: <StickyNote />, run: () => composer.current?.focus("note") },
        ...(aiOn ? [{ id: "ai-draft", label: tAi("composer.command"), shortcut: "mod j", icon: <AiIcon />, run: () => composer.current?.aiDraft() }] : []),
        { id: "assign-me", label: "Assign to me", shortcut: "i", icon: <UserRound />, run: assignMe },
        { id: "assign", label: "Assign to…", shortcut: "a", icon: <UserRound />, run: () => setAssignOpen(true) },
        { id: "solve", label: solved ? "Reopen ticket" : "Solve ticket", shortcut: "e", icon: <CircleCheck />, run: solve },
        { id: "merge", label: "Merge into another ticket", icon: <GitMerge />, run: () => setMergeOpen(true) },
        { id: "spam", label: t.spam ? "Not spam" : "Mark as spam", icon: <ShieldAlert />, run: spam },
      ],
    });
    return () => usePageCommands.setState({ commands: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, t?.status, t?.spam, canEdit, aiOn]);

  if (ticket.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          lit={3}
          title={isApiError(ticket.error, "not_found") ? "This ticket doesn't exist" : "Couldn't load this ticket"}
          description={isApiError(ticket.error, "not_found") ? "It may have been deleted or merged." : "Check your connection and try again."}
          action={<Button onClick={onClose}>Back to the list</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Tooltip content="Close" shortcut="esc">
          <Button variant="ghost" size="sm" square aria-label="Close ticket" icon={<X className="size-4" />} onClick={onClose} />
        </Tooltip>
        <div className="flex items-center">
          <Tooltip content="Previous" shortcut="k">
            <Button variant="ghost" size="sm" square aria-label="Previous ticket" disabled={!onPrev} onClick={onPrev} icon={<ChevronUp className="size-4" />} />
          </Tooltip>
          <Tooltip content="Next" shortcut="j">
            <Button variant="ghost" size="sm" square aria-label="Next ticket" disabled={!onNext} onClick={onNext} icon={<ChevronDown className="size-4" />} />
          </Tooltip>
          {position && (
            <span className="mono ml-1 hidden text-[11px] text-fg-4 tabular-nums sm:inline">
              {position.index} / {position.total}
            </span>
          )}
        </div>
        <span className="mx-1 h-5 w-px bg-line" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {t ? (
            <>
              <TicketNumber n={t.number} className="shrink-0" />
              <SubjectEditor value={t.subject} disabled={!canEdit} onSave={(subject) => update.mutate({ id: t.id, patch: { subject } })} />
              {t.spam && <span className="shrink-0 rounded-sm bg-hover px-1.5 py-0.5 text-[11px] font-medium text-fg-2">Spam</span>}
            </>
          ) : (
            <Skeleton className="h-3 w-64" />
          )}
        </div>
        {viewers.length > 0 && (
          <Tooltip content={viewers.map((v) => `${v.name} ${v.state === "replying" ? "is replying" : "is here"}`).join(", ")}>
            <span className="flex items-center">
              <AvatarStack people={viewers.map((v) => ({ id: v.user_id, name: v.name, avatar: v.avatar, state: v.state }))} />
            </span>
          </Tooltip>
        )}
        {t && canEdit && (
          <div className="flex items-center gap-1">
            <Tooltip content={solved ? "Reopen" : "Solve"} shortcut="e">
              <Button size="sm" variant="secondary" icon={solved ? <RotateCcw className="size-3.5" /> : <CircleCheck className="size-3.5" />} onClick={solve}>
                {solved ? "Reopen" : "Solve"}
              </Button>
            </Tooltip>
            <SnoozeMenu
              onSnooze={(at) => {
                update.mutate({ id: t.id, patch: { snoozed_until: at.toISOString(), status: "on_hold" } });
                toast.success("Snoozed");
                if (onNext) onNext();
              }}
            />
            <Menu>
              <Tooltip content="More">
                <MenuTrigger asChild>
                  <Button variant="ghost" size="sm" square aria-label="More actions" icon={<MoreHorizontal className="size-4" />} />
                </MenuTrigger>
              </Tooltip>
              <MenuContent align="end" className="w-[210px]">
                <MenuItem icon={<UserRound />} shortcut="i" onSelect={assignMe}>
                  Assign to me
                </MenuItem>
                <MenuItem icon={<GitMerge />} onSelect={() => setMergeOpen(true)}>
                  Merge into another ticket
                </MenuItem>
                <MenuItem
                  icon={<Copy />}
                  onSelect={async () => {
                    if (await copyText(`${location.origin}/inbox/open/${t.id}`)) toast.success("Link copied");
                  }}
                >
                  Copy link
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={t.spam ? <ShieldCheck /> : <ShieldAlert />} onSelect={spam}>
                  {t.spam ? "Not spam" : "Mark as spam"}
                </MenuItem>
                <MenuItem icon={<Trash2 />} danger onSelect={remove}>
                  Delete ticket
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        )}
        <Tooltip content={panel ? "Hide details" : "Show details"} shortcut="]">
          <Button variant="ghost" size="sm" square aria-label="Toggle details" aria-pressed={panel} onClick={togglePanel} icon={<PanelRight className="size-4" />} className={cn(panel && "text-fg")} />
        </Tooltip>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col bg-canvas/40 dark:bg-transparent">
          <Timeline
            ticketId={realId}
            messages={messages.data}
            activities={activities.data}
            loading={!messages.data}
            onRetry={(m) => composer.current?.retry(m)}
            contactName={t?.contact?.name}
          />
          {t && canEdit && <Composer ref={composer} ticket={t} />}
        </div>
        {panel && (
          <aside aria-label="Ticket details" className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-line lg:block">
            {t ? (
              <TicketProperties t={t} assignOpen={assignOpen} onAssignOpenChange={setAssignOpen} />
            ) : (
              <div className="flex flex-col gap-3 p-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-3" style={{ width: `${50 + i * 8}%` }} />
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
      {t && <MergeDialog ticket={t} open={mergeOpen} onOpenChange={setMergeOpen} />}
    </div>
  );
}
