// Ollie in the app header: the blob as a button that opens the panel (⌘J), and
// the anchor for tips.

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { q } from "@/lib/queries";
import { OllieMark } from "./OllieMark";
import { useAssistantName } from "./name";
import { ollie, useOllie } from "./store";
import { OllieTip } from "./OllieTip";

/** Whether the assistant is on for this workspace and instance. */
export function useAssistantOn(): boolean {
  const { data } = useQuery(q.aiConfig());
  return !!data?.enabled && data.features?.enabled !== false && data.features?.assistant !== false;
}

export function OllieButton() {
  const { t } = useTranslation("assistant");
  const name = useAssistantName();
  const on = useAssistantOn();
  const open = useOllie((s) => s.open);
  const running = useOllie((s) => s.running);
  const approval = useOllie((s) => !!s.approval);
  const lastOk = useOllie((s) => s.lastOk);
  if (!on) return null;
  return (
    <div className="relative">
      <Tooltip content={open ? t("close", { name }) : t("open", { name })} shortcut="mod j" side="bottom">
        <button
          type="button"
          aria-label={open ? t("close", { name }) : t("open", { name })}
          aria-expanded={open}
          onClick={() => ollie.toggle()}
          className={cn(
            "ollie-host flex h-7 items-center gap-1.5 rounded-md pl-1 pr-2 text-[12.5px] text-fg-2 transition-colors hover:bg-chrome-hover hover:text-fg",
            open && "bg-chrome-active text-fg",
          )}
          data-ollie-button
        >
          <OllieMark size={20} state={approval ? "attention" : running ? "thinking" : "idle"} celebrate={lastOk} />
          <span className="hidden font-medium xl:inline">{name}</span>
        </button>
      </Tooltip>
      <OllieTip enabled={on} />
    </div>
  );
}
