// Availability for the user menu: online (assignable), away, offline, as a
// radio group inside a DropdownMenu. Prop-driven; the caller PATCHes
// /v1/members/me/availability with what onChange gives it.

import { DropdownMenu as M } from "radix-ui";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { presenceDot, type Presence } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

export type Availability = Presence;
export const AVAILABILITY: Availability[] = ["online", "away", "offline"];

/** The coloured dot on its own, for rows and triggers. */
export function AvailabilityDot({ value, className }: { value: Availability; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full transition-colors duration-200", presenceDot[value], className)} />;
}

export function AvailabilityMenuItems({
  value,
  onChange,
  openTickets,
  maxOpenTickets,
  label = true,
}: {
  value: Availability;
  onChange: (v: Availability) => void;
  /** Open + pending tickets assigned to the member, with the auto-assignment cap when one is set. */
  openTickets?: number;
  maxOpenTickets?: number | null;
  /** Show the "Availability" group label. */
  label?: boolean;
}) {
  const { t } = useTranslation("setup");
  return (
    <M.Group>
      {label && <M.Label className="px-2 pb-1 pt-1.5 label-caps">{t("availability.label")}</M.Label>}
      <M.RadioGroup value={value} onValueChange={(v) => onChange(v as Availability)}>
        {AVAILABILITY.map((a) => (
          <M.RadioItem
            key={a}
            value={a}
            className="relative flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2 text-[12.5px] text-fg outline-none transition-colors duration-100 data-[highlighted]:bg-hover"
          >
            <span className="flex size-3.5 items-center justify-center">
              <AvailabilityDot value={a} />
            </span>
            <span className="flex-1 truncate">{t(`availability.${a}`)}</span>
            <M.ItemIndicator>
              <Check className="size-3.5 text-fg" />
            </M.ItemIndicator>
          </M.RadioItem>
        ))}
      </M.RadioGroup>
      {openTickets !== undefined && (
        <p className="px-2 pb-1 pt-1 text-[11.5px] tabular-nums text-fg-3">
          {maxOpenTickets ? t("availability.capacity", { open: openTickets, max: maxOpenTickets }) : t("availability.capacity_none", { open: openTickets })}
        </p>
      )}
    </M.Group>
  );
}
