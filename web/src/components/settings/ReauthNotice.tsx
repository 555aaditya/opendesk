import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { errorMessage, isApiError } from "@/lib/api/client";
import { signOut } from "@/lib/session";

/** Owner-level operations need a session that passed 2FA and is less than 12 hours old. */
export function isReauthError(e: unknown) {
  return isApiError(e, "mfa_required") || isApiError(e, "reauth_required");
}

export function ReauthNotice({ error }: { error: unknown }) {
  const navigate = useNavigate();
  if (!error) return null;
  if (!isReauthError(error)) return <p className="text-xs text-danger-fg">{errorMessage(error)}</p>;
  const mfa = isApiError(error, "mfa_required");
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-sunken px-3 py-2.5">
      <p className="text-[12.5px] text-fg-2">
        {mfa ? "Turn on two-factor and sign in again to do this." : "Sign in again to confirm it's you."}
      </p>
      <Button
        size="xs"
        variant="secondary"
        onClick={async () => {
          const next = location.pathname + location.search;
          await signOut();
          void navigate({ to: "/login", search: { next } });
        }}
      >
        Sign in again
      </Button>
    </div>
  );
}
