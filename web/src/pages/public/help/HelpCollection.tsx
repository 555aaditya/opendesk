import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getRouteApi } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { ArticleList, Crumbs } from "@/components/help/parts";
import { EmptyState } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/app/RootLayout";
import { cn } from "@/lib/cn";
import { q } from "@/lib/queries";
import { tone, toneFor } from "@/lib/tones";

const route = getRouteApi("/help/$slug/c/$collection");

export default function HelpCollection() {
  const { slug, collection } = route.useParams();
  const { t } = useTranslation("public");
  const { data, isLoading, isError } = useQuery(q.publicCollection(slug, collection));
  useDocumentTitle(data?.collection.name);

  if (isError) return <EmptyState lit={2} title={t("help.topic_not_found_title")} description={t("help.topic_not_found_body")} />;

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-20 pt-10">
      {isLoading || !data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-4 size-9 rounded-md" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-3 w-80" />
          <div className="mt-6 flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        </div>
      ) : (
        <div className="animate-rise-in motion-reduce:animate-none">
          <Crumbs slug={slug} items={[{ label: data.collection.name }]} />
          <span className={cn("mb-4 flex size-9 items-center justify-center rounded-md", tone[toneFor(data.collection.name)].chip)} aria-hidden>
            <FileText className="size-4.5" strokeWidth={1.75} />
          </span>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]" dir="auto">
            {data.collection.name}
          </h1>
          {data.collection.description && (
            <p className="mt-2 text-[14.5px] leading-6 text-fg-3" dir="auto">
              {data.collection.description}
            </p>
          )}
          <p className="mt-3 text-[12px] tabular-nums text-fg-4">{t("help.articles", { count: data.articles.length })}</p>
          <div className="mt-6 border-t border-line pt-2">
            {data.articles.length ? <ArticleList slug={slug} articles={data.articles} /> : <EmptyState compact lit={0} title={t("help.topic_empty")} />}
          </div>
        </div>
      )}
    </div>
  );
}
