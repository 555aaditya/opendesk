import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRouteApi } from "@tanstack/react-router";
import { ArticleList, Crumbs, HelpSearchBox } from "@/components/help/parts";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/app/RootLayout";
import { q } from "@/lib/queries";

const route = getRouteApi("/help/$slug/search");

export default function HelpSearch() {
  const { slug } = route.useParams();
  const { q: term = "" } = route.useSearch();
  const { t } = useTranslation("public");
  useDocumentTitle(t("help.search"));
  const { data, isLoading, isFetching } = useQuery(q.publicSearch(slug, term));

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-20 pt-10">
      <Crumbs slug={slug} items={[{ label: t("help.search") }]} />
      <HelpSearchBox key={term} slug={slug} initial={term} size="lg" />
      <div className="mt-8" aria-live="polite">
        {term.trim().length < 2 ? (
          <EmptyState compact lit={1} title={t("help.search_min")} />
        ) : isLoading || (isFetching && !data) ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !data?.length ? (
          <EmptyState lit={3} title={t("help.no_results_title", { term })} description={t("help.no_results_body")} />
        ) : (
          <>
            <p className="mb-2 text-[12px] tabular-nums text-fg-4">{t("help.results", { count: data.length })}</p>
            <div className="border-t border-line pt-2">
              <ArticleList slug={slug} articles={data} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
