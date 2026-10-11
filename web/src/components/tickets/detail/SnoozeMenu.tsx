import { addDays, addHours, nextMonday, setHours, setMinutes, startOfHour, format } from "date-fns";
import { AlarmClock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

function at9(d: Date) {
  return setMinutes(setHours(d, 9), 0);
}

export function snoozeOptions(now = new Date()) {
  return [
    { key: "hour", label: "In 1 hour", at: startOfHour(addHours(now, 2)) },
    { key: "hours", label: "In 4 hours", at: startOfHour(addHours(now, 5)) },
    { key: "tomorrow", label: "Tomorrow", at: at9(addDays(now, 1)) },
    { key: "week", label: "Next week", at: at9(nextMonday(now)) },
  ] as const;
}

export function SnoozeMenu({ onSnooze, disabled, open: openProp, onOpenChange }: { onSnooze: (at: Date) => void; disabled?: boolean; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const { t } = useTranslation("inbox");
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (o: boolean) => {
    setInnerOpen(o);
    onOpenChange?.(o);
  };
  const [custom, setCustom] = useState("");
  const opts = snoozeOptions();
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[240px] p-1"
      trigger={
        <Tooltip content={t("snooze.title")} shortcut="h">
          <Button variant="ghost" size="sm" square aria-label="Snooze" disabled={disabled} icon={<AlarmClock className="size-3.5" />} />
        </Tooltip>
      }
    >
      <div className="label-caps px-2 pb-1 pt-1.5">{t("snooze.until")}</div>
      {opts.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => {
            onSnooze(o.at);
            setOpen(false);
          }}
          className="flex h-8 w-full items-center justify-between rounded-md px-2 text-[12.5px] outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
        >
          {t(`snooze.${o.key}`)}
          <span className="mono text-[11px] text-fg-4">{format(o.at, "EEE HH:mm")}</span>
        </button>
      ))}
      <div className="mt-1 border-t border-line p-1.5 pt-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new Date(custom);
            if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
              onSnooze(d);
              setOpen(false);
            }
          }}
        >
          <TextInput type="datetime-local" inputSize="sm" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label={t("snooze.until")} className="mono text-[11.5px]" />
          <Button type="submit" size="sm" disabled={!custom}>
            {t("snooze.set")}
          </Button>
        </form>
      </div>
    </Popover>
  );
}
