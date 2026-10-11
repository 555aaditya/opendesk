import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ShieldAlert, Tag as TagIcon, Trash2, UserRound, X, CircleDot } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Picker } from "@/components/ui/picker";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/components/ui/confirm";
import { toast } from "@/components/ui/toast";
import type { TicketStatus } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { plural } from "@/lib/format";
import { StatusIcon, statusLabel, statusOrder } from "./bits";
import { useBulkUpdate } from "./useTicketActions";

export function BulkBar({ ids, onClear, spamView }: { ids: string[]; onClear: () => void; spamView?: boolean }) {
  const bulk = useBulkUpdate();
  const confirm = useConfirm();
  const { data: members } = useQuery(q.members());
  const { data: tags } = useQuery(q.tags());
  const [tagSel, setTagSel] = useState<string[]>([]);
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
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          role="toolbar"
          aria-label="Bulk actions"
          className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-line bg-raised p-1.5 pl-3 shadow-float"
        >
          <span className="mono mr-2 whitespace-nowrap text-[12px] text-fg-2 tabular-nums">{plural(n, "ticket")} selected</span>
          <span className="mx-1 h-5 w-px bg-line" />
          <Picker
            side="top"
            placeholder="Assign to"
            value={null}
            items={[
              { value: "__none", label: "Unassigned", icon: <span className="size-4 rounded-full border border-dashed border-line-strong" /> },
              ...(members ?? [])
                .filter((m) => m.role !== "viewer")
                .map((m) => ({ value: m.user.id, label: m.user.name, icon: <Avatar name={m.user.name} src={m.user.avatar_url} size="xs" /> })),
            ]}
            onSelect={(v) => run({ ids, patch: { assignee_id: v === "__none" ? null : v } }, `Assigned ${plural(n, "ticket")}`)}
            trigger={
              <Button variant="ghost" size="sm" icon={<UserRound className="size-3.5" />}>
                Assign
              </Button>
            }
          />
          <Picker
            side="top"
            placeholder="Set status"
            value={null}
            items={statusOrder.map((s) => ({ value: s, label: statusLabel[s], icon: <StatusIcon status={s} /> }))}
            onSelect={(v) => run({ ids, patch: { status: v as TicketStatus } }, `Marked ${plural(n, "ticket")} ${statusLabel[v as TicketStatus].toLowerCase()}`)}
            trigger={
              <Button variant="ghost" size="sm" icon={<CircleDot className="size-3.5" />}>
                Status
              </Button>
            }
          />
          <Picker
            side="top"
            multi
            placeholder="Add tags"
            values={tagSel}
            onChange={setTagSel}
            onCreate={(name) => setTagSel((s) => [...s, name])}
            createLabel="Add tag"
            items={[...(tags ?? []).map((t) => ({ value: t.name, label: t.name })), ...tagSel.filter((x) => !tags?.some((t) => t.name === x)).map((x) => ({ value: x, label: x }))]}
            onOpenChange={(o) => {
              if (!o && tagSel.length) {
                run({ ids, patch: { tags: tagSel } }, `Tagged ${plural(n, "ticket")}`);
                setTagSel([]);
              }
            }}
            trigger={
              <Button variant="ghost" size="sm" icon={<TagIcon className="size-3.5" />}>
                Tag
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<ShieldAlert className="size-3.5" />}
            onClick={() => run({ ids, patch: { spam: !spamView } }, spamView ? `Moved ${plural(n, "ticket")} out of spam` : `Marked ${plural(n, "ticket")} as spam`)}
          >
            {spamView ? "Not spam" : "Spam"}
          </Button>
          <Tooltip content="Delete">
            <Button
              variant="ghost"
              size="sm"
              square
              aria-label="Delete"
              icon={<Trash2 className="size-3.5" />}
              onClick={() =>
                confirm.show(
                  `${plural(n, "ticket")} will be deleted for everyone in the workspace.`,
                  async () => {
                    await bulk.mutateAsync({ ids, delete: true });
                    onClear();
                    toast.success(`Deleted ${plural(n, "ticket")}`);
                  },
                  { title: `Delete ${plural(n, "ticket")}?`, confirmLabel: "Delete", danger: true },
                )
              }
            />
          </Tooltip>
          <span className="mx-1 h-5 w-px bg-line" />
          <Tooltip content="Clear selection" shortcut="esc">
            <Button variant="ghost" size="sm" square aria-label="Clear selection" icon={<X className="size-3.5" />} onClick={onClear} />
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
