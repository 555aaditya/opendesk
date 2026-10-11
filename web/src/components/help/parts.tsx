import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, FileText, Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { KbArticle } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { shortDate } from "@/lib/format";

export function HelpSearchBox({ slug, initial = "", size = "md", autoFocus }: { slug: string; initial?: string; size?: "md" | "lg"; autoFocus?: boolean }) {
  const { t } = useTranslation("public");
  const [value, setValue] = useState(initial);
  const navigate = useNavigate();
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (v) void navigate({ to: "/help/$slug/search", params: { slug }, search: { q: v } });
      }}
      className="relative w-full"
    >
      <Search className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-fg-3", size === "lg" ? "start-4 size-[18px]" : "start-3 size-3.5")} />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("help.search_placeholder")}
        aria-label={t("help.search_placeholder")}
        className={cn(
          "w-full rounded-lg border border-line bg-surface text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-4 hover:border-line-strong focus:border-fg-3 focus:shadow-[0_0_0_3px_var(--focus)] [&::-webkit-search-cancel-button]:hidden",
          size === "lg" ? "h-12 ps-11 pe-4 text-[15px] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)]" : "h-8 ps-8 pe-3 text-[13px]",
        )}
      />
    </form>
  );
}

export function ArticleRow({ slug, article }: { slug: string; article: KbArticle }) {
  return (
    <Link
      to="/help/$slug/a/$article"
      params={{ slug, article: article.slug }}
      className="group flex items-start gap-3 border-b border-line-soft px-1 py-4 last:border-0"
    >
      <FileText className="mt-0.5 size-4 shrink-0 text-fg-4 transition-colors group-hover:text-fg-2" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium tracking-[-0.01em] text-fg group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
          <bdi>{article.title}</bdi>
        </span>
        {article.excerpt && <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-fg-3">
            <bdi>{article.excerpt}</bdi>
          </span>}
      </span>
      <span className="mt-1 hidden shrink-0 text-[11.5px] tabular-nums text-fg-4 sm:block">{shortDate(article.published_at ?? article.updated_at)}</span>
      <ArrowRight className="mt-1 size-3.5 shrink-0 -translate-x-1 text-fg-4 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 rtl:-scale-x-100 rtl:translate-x-1" />
    </Link>
  );
}

export function Crumbs({ slug, items }: { slug: string; items: { label: string; to?: { collection: string } }[] }) {
  const { t } = useTranslation("public");
  return (
    <nav aria-label={t("help.breadcrumb")} className="mb-6 flex flex-wrap items-center gap-1 text-[12.5px] text-fg-3">
      <Link to="/help/$slug" params={{ slug }} className="hover:text-fg">
        {t("help.default_title")}
      </Link>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1">
          <ChevronRight className="size-3 text-fg-4 rtl:-scale-x-100" />
          {i.to ? (
            <Link to="/help/$slug/c/$collection" params={{ slug, collection: i.to.collection }} className="hover:text-fg">
              <bdi>{i.label}</bdi>
            </Link>
          ) : (
            <bdi className="text-fg-2">{i.label}</bdi>
          )}
        </span>
      ))}
    </nav>
  );
}
