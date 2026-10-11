import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { Crumbs } from "@/components/help/parts";
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

  if (isError)
    return (
      <div className="py-24">
        <EmptyState lit={2} title={t("help.article_not_found_title")} description={t("help.article_not_found_body")} />
      </div>
    );

  return (
    <article className="mx-auto max-w-[720px] px-5 pb-24 pt-10">
      {isLoading || !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="mt-2 h-9 w-3/4" />
          <Skeleton className="h-3 w-40" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mt-2 h-3" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
          ))}
        </div>
      ) : (
        <>
          <Crumbs slug={slug} items={[...(collection ? [{ label: collection.name, to: { collection: collection.slug } }] : []), { label: data.title }]} />
          <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.035em] sm:text-[34px]" dir="auto">
            {data.title}
          </h1>
          <p className="mt-3 text-[12px] text-fg-4">
            <time dateTime={data.updated_at} title={fullDate(data.updated_at)}>
              {t("help.updated", { date: longDate(data.updated_at) })}
            </time>
          </p>
          <div className="mt-8 h-px bg-line" />
          <div className="prose-od prose-lg mt-8" dir="auto" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
    </article>
  );
}
