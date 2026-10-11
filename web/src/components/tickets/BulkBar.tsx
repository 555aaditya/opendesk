import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ShieldAlert, Signal, Tag as TagIcon, Trash2, UserRound, X, CircleDot } from "lucide-react";
import { forwardRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import type { Priority, TicketStatus } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { PriorityIcon, priorityLabel, priorityOrder, StatusIcon, statusLabel, statusOrder } from "./bits";
import { useLabelChoices } from "./detail/LabelPicker";
import { useDisplay } from "./fields";
import { useBulkUpdate } from "./useTicketActions";

/** A bar action: labelled, or icon-only with a tooltip when the list is narrow. */
const Act = forwardRef<HTMLButtonElement, { compact?: boolean; icon: ReactNode; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>>(function Act(
  { compact, icon, label, ...rest },
  ref,
) {
  if (!compact)
    return (
      <Button ref={ref} variant="ghost" size="sm" icon={icon} {...rest}>
        {label}
      </Button>
    );
  return (
    <Tooltip content={label}>
      <Button ref={ref} variant="ghost" size="sm" square aria-label={label} icon={icon} {...rest} />
    </Tooltip>
  );
});

export function BulkBar({ ids, onClear, spamView, compact }: { ids: string[]; onClear: () => void; spamView?: boolean; compact?: boolean }) {
  const { t } = useTranslation("inbox");
  const bulk = useBulkUpdate();
  const confirm = useConfirm();
  const { data: members } = useQuery(q.members());
  const { data: tags } = useQuery(q.tags());
  const [tagSel, setTagSel] = useState<string[]>([]);
  const labelChoices = useLabelChoices();
  const display = useDisplay();
  const n = ids.length;

  const run = (b: Parameters<typeof bulk.mutate>[0], done: string) =>
    bulk.mutate(b, { onSuccess: () => toast.success(done) });

  return (
    <AnimatePresence>
      {n > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 520, damping: 38 }}
          role="toolbar"
          aria-label="Bulk actions"
          className="absolute bottom-5 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-raised p-1 pl-3 shadow-float"
        >
          <motion.span key={n} initial={{ opacity: 0.4, y: -2 }} animate={{ opacity: 1, y: 0 }} className="mr-2 whitespace-nowrap text-[12px] text-fg-2 tabular-nums">
            {compact ? n : t("bulk.selected", { count: n })}
          </motion.span>
          <span className="mx-1 h-5 w-px bg-line" />
          <Picker
            side="top"
            placeholder={t("bulk.assignTo")}
            value={null}
            items={[
              { value: "__none", label: t("bulk.unassigned"), icon: <span className="size-4 rounded-xs border border-dashed border-line-strong" /> },
              ...(members ?? [])
                .filter((m) => m.role !== "viewer")
                .map((m) => ({ value: m.user.id, label: m.user.name, icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> })),
            ]}
            onSelect={(v) => run({ ids, patch: { assignee_id: v === "__none" ? null : v } }, t("bulk.assigned", { count: n }))}
            trigger={
              <Act compact={compact} icon={<UserRound className="size-3.5" />} label={t("bulk.assign")} />
            }
          />
          <Picker
            side="top"
            placeholder={t("bulk.setStatus")}
            value={null}
            items={statusOrder.map((s) => ({ value: s, label: display.status(s), icon: <StatusIcon status={s} /> }))}
            onSelect={(v) => run({ ids, patch: { status: v as TicketStatus } }, t("bulk.marked", { count: n, status: statusLabel[v as TicketStatus].toLowerCase() }))}
            trigger={
              <Act compact={compact} icon={<CircleDot className="size-3.5" />} label={t("bulk.status")} />
            }
          />
          <Picker
            side="top"
            placeholder={t("bulk.setPriority")}
            value={null}
            items={priorityOrder.map((p) => ({ value: p, label: display.priority(p), icon: <PriorityIcon priority={p} /> }))}
            onSelect={(v) => run({ ids, patch: { priority: v as Priority } }, t("bulk.prioritised", { count: n, priority: priorityLabel[v as Priority].toLowerCase() }))}
            trigger={
              <Act compact={compact} icon={<Signal className="size-3.5" />} label={t("bulk.priority")} />
            }
          />
          <Picker
            side="top"
            multi
            placeholder="Add tags"
            values={tagSel}
            onChange={(v) => setTagSel(labelChoices.resolve(tagSel, v))}
            onCreate={(name) => setTagSel((s) => [...s, name])}
            createLabel="Add tag"
            items={[...labelChoices.items, ...tagSel.filter((x) => !tags?.some((g) => g.name === x)).map((x) => ({ value: x, label: x }))]}
            onOpenChange={(o) => {
              if (!o && tagSel.length) {
                run({ ids, patch: { add_tags: tagSel } }, t("bulk.tagged", { count: n }));
                setTagSel([]);
              }
            }}
            trigger={
              <Act compact={compact} icon={<TagIcon className="size-3.5" />} label={t("bulk.tag")} />
            }
          />
          <Act
            compact={compact}
            icon={<ShieldAlert className="size-3.5" />}
            label={spamView ? t("bulk.notSpam") : t("bulk.spam")}
            onClick={() => run({ ids, patch: { spam: !spamView } }, spamView ? t("bulk.unspammed", { count: n }) : t("bulk.spammed", { count: n }))}
          />
          <Tooltip content={t("bulk.delete")}>
            <Button
              variant="ghost"
              size="sm"
              square
              aria-label="Delete"
              icon={<Trash2 className="size-3.5" />}
              onClick={() =>
                confirm.show(
                  t("bulk.deleteBody", { count: n }),
                  async () => {
                    await bulk.mutateAsync({ ids, delete: true });
                    onClear();
                    toast.success(t("bulk.deleted", { count: n }));
                  },
                  { title: t("bulk.deleteTitle", { count: n }), confirmLabel: t("bulk.delete"), danger: true },
                )
              }
            />
          </Tooltip>
          <span className="mx-1 h-5 w-px bg-line" />
          <Tooltip content={t("bulk.clear")} shortcut="esc">
            <Button variant="ghost" size="sm" square aria-label="Clear selection" icon={<X className="size-3.5" />} onClick={onClear} />
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
