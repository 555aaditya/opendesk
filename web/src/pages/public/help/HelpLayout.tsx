import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Lockup } from "@/components/brand";
import { EmptyState } from "@/components/ui/empty";
import { HelpSearchBox } from "@/components/help/parts";
import { LanguageSwitcher, usePublicLocale } from "@/components/help/locale";
import "@/components/help/help.css";
import { useDocumentTitle } from "@/app/RootLayout";
import { q } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

const route = getRouteApi("/help/$slug");

export default function HelpLayout() {
  const { slug } = route.useParams();
  const { data, isError, isPending } = useQuery(q.publicHelp(slug));
  const { locale, loaded } = usePublicLocale(data?.locale || undefined, !isPending);
  const { t } = useTranslation("public");
  const { dark, setTheme } = useTheme();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const atHome = path.replace(/\/+$/, "") === `/help/${slug}`;
  const title = data?.title || t("help.default_title");
  useDocumentTitle(atHome && loaded ? title : null);

  return (
    <div data-public-page className="flex min-h-dvh flex-col bg-surface text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[760px] items-center gap-4 px-5">
          <Link to="/help/$slug" params={{ slug }} className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-inverse text-[11.5px] font-semibold text-inverse-fg">
              {title.trim().charAt(0).toUpperCase()}
            </span>
            <bdi className="truncate text-[14px] font-semibold tracking-[-0.015em]">{title}</bdi>
          </Link>
          <div className="ms-auto flex items-center gap-2">
            {!atHome && loaded && (
              <div className="hidden w-[240px] sm:block">
                <HelpSearchBox key={path} slug={slug} />
              </div>
            )}
            <button
              type="button"
              aria-label={dark ? t("help.theme_light") : t("help.theme_dark")}
              onClick={() => setTheme(dark ? "light" : "dark")}
              className="flex size-8 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        {isError ? (
          loaded && (
            <div className="py-24">
              <EmptyState lit={2} title={t("help.not_found_title")} description={t("help.not_found_body")} />
            </div>
          )
        ) : (
          // Hold the page until its language is in, so English never flashes first.
          loaded && <Outlet />
        )}
      </main>
      <footer className="border-t border-line-soft">
        <div className="mx-auto flex h-14 max-w-[760px] items-center gap-3 px-5 text-xs text-fg-4">
          <span className="min-w-0 truncate">
            © {new Date().getFullYear()} {data?.title ?? ""}
          </span>
          <LanguageSwitcher current={locale} className="ms-auto" />
          <a href="https://opendesk.sh" className="flex items-center gap-1.5 hover:text-fg-2">
            {t("footer.powered_by")} <Lockup className="h-[11px]" />
          </a>
        </div>
      </footer>
    </div>
  );
}
