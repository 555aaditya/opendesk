import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRouteApi, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { ArticleRow, HelpSearchBox } from "@/components/help/parts";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { q } from "@/lib/queries";

const route = getRouteApi("/help/$slug/");

export default function HelpHome() {
  const { slug } = route.useParams();
  const { t } = useTranslation("public");
  const { data, isLoading } = useQuery(q.publicHelp(slug));

  return (
    <div>
      <section className="relative overflow-hidden border-b border-line-soft">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_60%_80%_at_50%_0%,black,transparent)]"
        />
        <div className="relative mx-auto max-w-[720px] px-5 pb-14 pt-16 text-center">
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.04em] sm:text-[38px]">{t("help.hero_title")}</h1>
          <p className="mt-2 text-[14px] text-fg-3">{t("help.hero_subtitle")}</p>
          <div className="mx-auto mt-7 max-w-[560px]">
            <HelpSearchBox slug={slug} size="lg" autoFocus />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[720px] px-5 py-12">
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-lg" />
            ))}
          </div>
        ) : !data?.collections.length && !data?.featured.length ? (
          <EmptyState lit={0} title={t("help.empty_title")} description={t("help.empty_body")} />
        ) : (
          <>
            {!!data?.collections.length && (
              <section aria-labelledby="topics">
                <h2 id="topics" className="label-caps mb-3">{t("help.topics")}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[...data.collections]
                    .sort((a, b) => a.position - b.position)
                    .map((c) => (
                      <Link
                        key={c.id}
                        to="/help/$slug/c/$collection"
                        params={{ slug, collection: c.slug }}
                        className="group relative flex flex-col rounded-lg border border-line bg-surface p-4 transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_20px_-12px_rgb(0_0_0/0.18)]"
                      >
                        <ArrowUpRight className="absolute end-3.5 top-3.5 size-3.5 text-fg-4 opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" />
                        <span className="text-[14.5px] font-semibold tracking-[-0.015em]">
                          <bdi>{c.name}</bdi>
                        </span>
                        {c.description && (
                          <span className="mt-1 line-clamp-2 text-[13px] leading-5 text-fg-3">
                            <bdi>{c.description}</bdi>
                          </span>
                        )}
                        <span className="mt-auto pt-3 text-[11.5px] text-fg-4">{t("help.articles", { count: c.article_count })}</span>
                      </Link>
                    ))}
                </div>
              </section>
            )}
            {!!data?.featured.length && (
              <section aria-labelledby="popular" className="mt-12">
                <h2 id="popular" className="label-caps mb-1">{t("help.popular")}</h2>
                <div>
                  {data.featured.map((a) => (
                    <ArticleRow key={a.id} slug={slug} article={a} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
