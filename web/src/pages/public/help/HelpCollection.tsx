import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRouteApi } from "@tanstack/react-router";
import { ArticleRow, Crumbs } from "@/components/help/parts";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/app/RootLayout";
import { q } from "@/lib/queries";

const route = getRouteApi("/help/$slug/c/$collection");

export default function HelpCollection() {
  const { slug, collection } = route.useParams();
  const { t } = useTranslation("public");
  const { data, isLoading, isError } = useQuery(q.publicCollection(slug, collection));
  useDocumentTitle(data?.collection.name);

  if (isError)
    return (
      <div className="py-24">
        <EmptyState lit={2} title={t("help.topic_not_found_title")} description={t("help.topic_not_found_body")} />
      </div>
    );

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-20 pt-10">
      {isLoading || !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-3 w-80" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mt-3 h-12" />
          ))}
        </div>
      ) : (
        <>
          <Crumbs slug={slug} items={[{ label: data.collection.name }]} />
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em]" dir="auto">
            {data.collection.name}
          </h1>
          {data.collection.description && <p className="mt-2 text-[14.5px] leading-6 text-fg-3" dir="auto">
              {data.collection.description}
            </p>}
          <p className="mt-3 text-[11.5px] text-fg-4">{t("help.articles", { count: data.articles.length })}</p>
          <div className="mt-6 border-t border-line">
            {data.articles.length ? (
              data.articles.map((a) => <ArticleRow key={a.id} slug={slug} article={a} />)
            ) : (
              <EmptyState compact lit={0} title={t("help.topic_empty")} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
