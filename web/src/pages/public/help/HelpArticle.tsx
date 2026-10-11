import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArticleList, Crumbs } from "@/components/help/parts";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/app/RootLayout";
import { fullDate, longDate } from "@/lib/format";
import { q } from "@/lib/queries";
import { sanitizeHtml } from "@/lib/sanitize";

const route = getRouteApi("/help/$slug/a/$article");

export default function HelpArticle() {
  const { slug, article } = route.useParams();
  const { t } = useTranslation("public");
  const { data, isLoading, isError } = useQuery(q.publicArticle(slug, article));
  const { data: home } = useQuery(q.publicHelp(slug));
  const html = useMemo(() => sanitizeHtml(data?.body_html ?? ""), [data?.body_html]);
  useDocumentTitle(data?.title);
  const collection = home?.collections.find((c) => c.id === data?.collection_id);
  // The rest of the topic, for reading on.
  const { data: siblings } = useQuery({ ...q.publicCollection(slug, collection?.slug ?? ""), enabled: !!collection });
  const more = (siblings?.articles ?? []).filter((a) => a.id !== data?.id).slice(0, 5);

  if (isError) return <EmptyState lit={2} title={t("help.article_not_found_title")} description={t("help.article_not_found_body")} />;

  return (
    <article className="mx-auto w-full max-w-[720px] px-5 pb-24 pt-10">
      {isLoading || !data ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="mt-3 h-9 w-3/4" />
          <Skeleton className="h-3 w-40" />
          <div className="mt-8 flex flex-col gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="animate-rise-in motion-reduce:animate-none">
          <Crumbs slug={slug} items={[...(collection ? [{ label: collection.name, to: { collection: collection.slug } }] : []), { label: data.title }]} />
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-fg sm:text-[34px]" dir="auto">
            {data.title}
          </h1>
          <div className="mt-4 flex items-center gap-2 text-[12.5px] text-fg-3">
            {data.author?.name && (
              <>
                <Avatar name={data.author.name} src={data.author.avatar_url} size="sm" />
                <bdi className="font-medium text-fg-2">{data.author.name}</bdi>
                <span aria-hidden className="text-fg-4">
                  ·
                </span>
              </>
            )}
            <time dateTime={data.updated_at} title={fullDate(data.updated_at)}>
              {t("help.updated", { date: longDate(data.updated_at) })}
            </time>
          </div>
          <div className="help-article prose-od prose-lg mt-10" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
          {collection && more.length > 0 && (
            <section aria-labelledby="more" className="mt-16 border-t border-line pt-8">
              <h2 id="more" className="label-caps mb-2">
                <bdi>{collection.name}</bdi>
              </h2>
              <ArticleList slug={slug} articles={more} compact />
            </section>
          )}
        </div>
      )}
    </article>
  );
}
