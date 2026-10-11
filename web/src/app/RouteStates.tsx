import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { errorMessage, isApiError } from "@/lib/api/client";

export function RoutePending() {
  return (
    <div className="flex h-full min-h-[200px] items-start justify-center pt-24">
      <div className="h-0.5 w-24 overflow-hidden rounded-full bg-hover">
        <div className="h-full w-1/3 animate-[pending-bar_1s_ease-in-out_infinite] rounded-full bg-fg-4" />
      </div>
    </div>
  );
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const notFound = isApiError(error, "not_found");
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        lit={3}
        title={notFound ? "Not found" : "This page couldn't load"}
        description={notFound ? "It may have been deleted, or you don't have access." : errorMessage(error)}
        action={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                void router.invalidate();
              }}
            >
              Try again
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/">Go to inbox</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <EmptyState
        lit={2}
        title="Page not found"
        description="The link may be broken, or the page may have moved."
        action={
          <Button variant="secondary" asChild>
            <Link to="/">Go home</Link>
          </Button>
        }
      />
    </div>
  );
}
