// The topbar of the work column. Its hairline lines up with the sidebar's brand
// row, so the page reads as one grid of modules: where you are on the left
// (mono slashes between crumbs), presence, notifications and New ticket on the right.

import { Link } from "@tanstack/react-router";
import { Menu as MenuIcon, Plus } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { atLeast, useRole } from "@/lib/session";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { NotificationsButton } from "./Notifications";
import { shell } from "./shellStore";
import { useBreadcrumbs } from "./useBreadcrumbs";

export function AppHeader() {
  const crumbs = useBreadcrumbs();
  const role = useRole();
  const { t } = useTranslation("shell");

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface pl-2 pr-3 md:pl-5">
      <button
        type="button"
        aria-label={t("nav.open")}
        onClick={() => shell.sidebar(true)}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-fg-2 hover:bg-hover md:hidden"
      >
        <MenuIcon className="size-4" />
      </button>

      <nav aria-label={t("breadcrumb")} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${c.label}-${i}`}>
                {i > 0 && (
                  <li aria-hidden className="mono shrink-0 text-[12px] text-line-strong">
                    /
                  </li>
                )}
                <li className={cn("min-w-0", !last && "hidden shrink-0 sm:block")}>
                  {last || !c.to ? (
                    <span
                      aria-current={last ? "page" : undefined}
                      title={c.label}
                      className={cn("block truncate text-[13px]", last ? "font-medium text-fg" : "text-fg-3")}
                      data-ph-mask={last || undefined}
                    >
                      {c.label}
                    </span>
                  ) : (
                    <Link
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      to={c.to as any}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      params={c.params as any}
                      className="block truncate rounded-sm text-[13px] text-fg-3 outline-none transition-colors hover:text-fg focus-visible:shadow-[0_0_0_1.5px_var(--focus)]"
                    >
                      {c.label}
                    </Link>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <div className="flex shrink-0 items-center gap-0.5">
        <ConnectionIndicator />
        <NotificationsButton />
        {atLeast(role, "agent") && (
          <Tooltip content={t("newTicket")} shortcut="c">
            <button
              type="button"
              aria-label={t("newTicket")}
              onClick={() => shell.newTicket()}
              className="ml-2 flex h-7 items-center gap-1.5 rounded-md bg-inverse pl-2 pr-1.5 text-[12.5px] font-medium text-inverse-fg outline-none transition-[background-color,transform] hover:bg-inverse-hover focus-visible:shadow-[0_0_0_1px_var(--surface),0_0_0_2.5px_var(--focus)] active:translate-y-px max-sm:w-7 max-sm:justify-center max-sm:px-0"
            >
              <Plus className="size-3.5" />
              <span className="hidden sm:inline">{t("newTicket")}</span>
              <Kbd className="ml-0.5 hidden sm:inline-flex [&_kbd]:border-inverse-fg/20 [&_kbd]:bg-transparent [&_kbd]:text-inverse-fg/70">c</Kbd>
            </button>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
