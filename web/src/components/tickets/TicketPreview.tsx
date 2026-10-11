// A read-only look at the focused ticket, beside the list on wide screens.
// It follows j/k without opening the ticket (no presence, nothing marked),
// and Enter or a click opens it for real.

import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Ticket } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { relLong } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { TagChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ChannelIcon, channelLabel, PriorityPill, SlaPill, StatusPill, TicketNumber } from "./bits";
import { Timeline } from "./detail/Timeline";
import { useDisplay } from "./fields";

const noop = () => {};

export function TicketPreview({ ticket: t, onOpen, onReply }: { ticket: Ticket; onOpen: () => void; onReply?: () => void }) {
  const { t: tr } = useTranslation("inbox");
  const messages = useQuery(q.messages(t.id));
  const activities = useQuery(q.activities(t.id));
  const display = useDisplay();
  const contact = t.contact?.name || t.contact?.email || tr("row.unknown");

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={tr("preview.label")}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <TicketNumber n={t.number} className="shrink-0" />
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em]" data-ph-mask>
          {t.subject || tr("row.noSubject")}
        </h2>
        {onReply && (
          <Tooltip content={tr("preview.reply")} shortcut="r">
            <Button size="sm" variant="ghost" icon={<MessageSquare className="size-3.5" />} onClick={onReply}>
              {tr("preview.replyShort")}
            </Button>
          </Tooltip>
        )}
        <Tooltip content={tr("preview.openHint")} shortcut="enter">
          <Button size="sm" variant="secondary" iconRight={<CornerDownLeft className="size-3 text-fg-4" />} onClick={onOpen}>
            {tr("preview.open")}
          </Button>
        </Tooltip>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line-soft px-4 py-2.5">
        <StatusPill status={t.status} label={display.status(t.status)} hue={display.statusTone(t.status)} />
        {t.priority !== "normal" && <PriorityPill priority={t.priority} label={display.priority(t.priority)} hue={display.priorityTone(t.priority)} />}
        <SlaPill ticket={t} />
        {t.tags.map((tag) => (
          <TagChip key={tag.id} name={tag.name} color={tag.color} />
        ))}
        <span className="ml-auto flex min-w-0 items-center gap-3 text-xs text-fg-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <Tooltip content={channelLabel[t.channel]}>
              <span className="flex">
                <ChannelIcon channel={t.channel} />
              </span>
            </Tooltip>
            <span className="truncate text-fg-2" data-ph-mask>
              {contact}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {t.assignee ? (
              <>
                <Avatar name={t.assignee.name} src={t.assignee.avatar_url} size="xs" />
                <span className="text-fg-2">{t.assignee.name}</span>
              </>
            ) : (
              <span className="text-fg-4">{tr("preview.unassigned")}</span>
            )}
          </span>
          <span className="hidden shrink-0 text-fg-4 2xl:inline">{tr("preview.created", { when: relLong(t.created_at) })}</span>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Timeline
          ticketId={t.id}
          messages={messages.data}
          activities={activities.data}
          loading={!messages.data}
          onRetry={noop}
          contactName={t.contact?.name}
        />
      </div>
    </div>
  );
}
