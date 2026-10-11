import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet, useMatches, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { LucideProvider } from "lucide-react";
import { ConfirmProvider } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { pageview } from "@/lib/analytics";
import { queryClient } from "@/lib/queryClient";

function useRouteTitle() {
  const matches = useMatches();
  const title = [...matches].reverse().find((m) => m.staticData?.title)?.staticData.title;
  useEffect(() => {
    document.title = title ? `${title} · opendesk` : "opendesk";
  }, [title]);
}

function usePageviews() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => pageview(path), [path]);
}

export function RootLayout() {
  useRouteTitle();
  usePageviews();
  return (
    <QueryClientProvider client={queryClient}>
      <LucideProvider strokeWidth={1.5}>
      <TooltipProvider delayDuration={400} skipDelayDuration={200}>
        <ConfirmProvider>
          <Outlet />
          <Toaster />
        </ConfirmProvider>
      </TooltipProvider>
      </LucideProvider>
    </QueryClientProvider>
  );
}

/** Set a page-specific tab title (a ticket subject, an article). */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · opendesk`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
