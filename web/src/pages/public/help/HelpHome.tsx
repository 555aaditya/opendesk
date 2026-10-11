import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRouteApi } from "@tanstack/react-router";
import { ArticleList, CollectionCard, HelpSearchBox } from "@/components/help/parts";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { q } from "@/lib/queries";

const route = getRouteApi("/help/$slug/");

export default function HelpHome() {
  const { slug } = route.useParams();
  const { t } = useTranslation("public");
  const { data, isLoading } = useQuery(q.publicHelp(slug));
  const collections = [...(data?.collections ?? [])].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-1 flex-col">
      <section className="border-b border-line-soft bg-sunken">
        <div className="mx-auto max-w-[680px] animate-rise-in px-5 pb-16 pt-14 text-center motion-reduce:animate-none sm:pt-20">
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.035em] text-fg sm:text-[36px]">{t("help.hero_title")}</h1>
          <p className="mt-2 text-[14px] text-fg-3">{t("help.hero_subtitle")}</p>
          <div className="mx-auto mt-8 max-w-[560px]">
            <HelpSearchBox slug={slug} size="lg" autoFocus />
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-[960px] flex-1 flex-col px-5 py-12 sm:py-14">
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[148px] rounded-lg" />
            ))}
          </div>
        ) : !collections.length && !data?.featured.length ? (
          <EmptyState lit={0} title={t("help.empty_title")} description={t("help.empty_body")} />
        ) : (
          <>
            {!!collections.length && (
              <section aria-labelledby="topics">
                <h2 id="topics" className="label-caps mb-4">
                  {t("help.topics")}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {collections.map((c, i) => (
                    <CollectionCard key={c.id} slug={slug} c={c} index={i} />
                  ))}
                </div>
              </section>
            )}
            {!!data?.featured.length && (
              <section aria-labelledby="popular" className={collections.length ? "mt-14" : undefined}>
                <h2 id="popular" className="label-caps mb-2">
                  {t("help.popular")}
                </h2>
                <ArticleList slug={slug} articles={data.featured} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
