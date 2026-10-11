// The empty state for a settings list: the shared EmptyState with the list's
// ghost layout behind it, one line on what the thing is and why you would
// make one, a create action and two quiet tips. It fills its section card.

import type { ReactNode } from "react";
import { EmptyState, GhostList, type ArtKind, type EmptyTip } from "@/components/ui/empty";
import { cn } from "@/lib/cn";

export function SettingsEmpty({
  art = "settings",
  ghost = "table",
  title,
  description,
  action,
  secondary,
  tips,
  children,
  className,
}: {
  art?: ArtKind;
  ghost?: "table" | "people" | "tickets" | false;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
  /** Two short facts; an icon per tip keeps them scannable. */
  tips?: EmptyTip[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[360px] flex-col", className)}>
      <EmptyState
        art={art}
        ghost={ghost ? <GhostList variant={ghost} rows={8} /> : undefined}
        title={title}
        description={description}
        action={action}
        secondary={secondary}
        tips={tips?.map((t) => ({ ...t, icon: t.icon ? <span className="flex text-fg-4 [&_svg]:size-3">{t.icon}</span> : undefined }))}
        className="py-12"
      >
        {children}
      </EmptyState>
    </div>
  );
}
