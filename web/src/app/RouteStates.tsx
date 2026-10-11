import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { errorMessage, isApiError } from "@/lib/api/client";

/** A quiet bar while a route's code or data loads; it waits a beat so fast loads never flash. */
export function RoutePending() {
  const { t } = useTranslation("shell");
  return (
    <div className="flex h-full min-h-[200px] items-start justify-center pt-24 opacity-0 animate-[fade-in_200ms_ease-out_150ms_forwards] motion-reduce:animate-none motion-reduce:opacity-100" role="status" aria-label={t("route.loading")}>
      <div className="h-0.5 w-24 overflow-hidden rounded-full bg-hover">
        <div className="h-full w-1/3 animate-[pending-bar_1s_ease-in-out_infinite] rounded-full bg-fg-4 motion-reduce:animate-none" />
      </div>
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation("shell");
  const router = useRouter();
  const notFound = isApiError(error, "not_found");
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        lit={3}
        title={notFound ? t("route.notFoundTitle") : t("route.errorTitle")}
        description={notFound ? t("route.notFoundBody") : errorMessage(error)}
        action={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              {t("route.retry")}
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/">{t("route.toInbox")}</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}

export function NotFound() {
  const { t } = useTranslation("shell");
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <EmptyState
        lit={2}
        title={t("route.pageNotFound")}
        description={t("route.pageNotFoundBody")}
        action={
          <Button variant="secondary" asChild>
            <Link to="/">{t("route.home")}</Link>
          </Button>
        }
      />
    </div>
  );
}
