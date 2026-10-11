import { Link, Outlet } from "@tanstack/react-router";
import { Lockup } from "@/components/brand";

/** Quiet, centered pages for sign-in flows and onboarding. */
export function AuthLayout() {
  return (
    <div className="relative flex min-h-dvh flex-col bg-surface">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(var(--line)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_0%,black,transparent)]"
      />
      <header className="relative flex h-16 items-center px-6">
        <Link to="/" aria-label="opendesk home" className="text-fg">
          <Lockup className="h-[18px]" />
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-[8vh]">
        <div className="w-full max-w-[360px]">
          <Outlet />
        </div>
      </main>
      <footer className="relative flex h-12 items-center justify-center gap-4 text-xs text-fg-4">
        <a href="https://opendesk.sh" className="hover:text-fg-2">opendesk.sh</a>
        <a href="https://docs.opendesk.sh" className="hover:text-fg-2">Docs</a>
        <a href="https://opendesk.sh/privacy" className="hover:text-fg-2">Privacy</a>
      </footer>
    </div>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.03em] text-fg">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13px] text-fg-3">{subtitle}</p>}
    </div>
  );
}
