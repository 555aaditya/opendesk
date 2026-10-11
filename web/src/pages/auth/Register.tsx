import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { AuthField, completeSignIn, Notice, OrDivider, PasswordInput, ProviderButtons, safeNext, StrengthMeter } from "@/components/auth/parts";
import { Turnstile, type TurnstileHandle } from "@/components/auth/Turnstile";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import { q } from "@/lib/queries";
import { track } from "@/lib/analytics";

const route = getRouteApi("/auth/register");

/** An invitation link that sent the visitor here carries its token in `next`. */
function inviteTokenFrom(next: string | undefined): string | undefined {
  const n = safeNext(next);
  if (!n) return undefined;
  const u = new URL(n, location.origin);
  return u.pathname === "/invite" ? (u.searchParams.get("token") ?? undefined) : undefined;
}

export default function Register() {
  const search = route.useSearch();
  const router = useRouter();
  const { data: cfg } = useQuery(q.authConfig());
  const invite = useMemo(() => inviteTokenFrom(search.next), [search.next]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState(search.email ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const closed = cfg?.signup_enabled === false && !invite;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Tell us your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < 12) return setError("Use at least 12 characters for your password.");
    if (password.length > 128) return setError("Use at most 128 characters for your password.");
    setBusy(true);
    try {
      const tok = await api.auth.register({
        name: name.trim(),
        email: email.trim(),
        password,
        turnstile_token: token ?? undefined,
        invite_token: invite,
      });
      track("signup_completed", { invited: !!invite });
      router.history.push(await completeSignIn(tok, search.next));
    } catch (err) {
      setBusy(false);
      turnstile.current?.reset();
      if (isApiError(err, "email_taken") || isApiError(err, "conflict"))
        setError(
          <>
            An account already uses this email.{" "}
            <Link to="/login" search={{ next: search.next }} className="font-medium text-fg underline underline-offset-2">
              Log in instead
            </Link>
          </>,
        );
      else if (isApiError(err, "signup_disabled")) setError("New sign-ups are turned off. Ask an admin for an invitation.");
      else setError(errorMessage(err));
    }
  };

  if (closed)
    return (
      <div>
        <AuthHeading title="Sign-ups are closed" subtitle="This opendesk instance only accepts new accounts by invitation." />
        <Button variant="secondary" size="lg" className="w-full" asChild>
          <Link to="/login">Back to log in</Link>
        </Button>
      </div>
    );

  return (
    <div>
      <AuthHeading title="Create your account" subtitle={invite ? "You're joining a workspace. Create an account to accept." : "Set up a shared inbox for your team in a few minutes."} />
      {!invite && (
        <>
          <ProviderButtons next={search.next} verb="Sign up" />
          {!!cfg?.providers.length && <OrDivider />}
        </>
      )}
      {error && <Notice className="mb-4">{error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AuthField label="Name">
          {(id) => <TextInput id={id} className="h-9" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />}
        </AuthField>
        <AuthField label="Work email">
          {(id) => (
            <TextInput id={id} className="h-9" type="email" autoComplete="email" value={email} readOnly={!!invite && !!search.email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          )}
        </AuthField>
        <AuthField label="Password">
          {(id) => (
            <div className="flex flex-col gap-2">
              <PasswordInput id={id} autoComplete="new-password" value={password} maxLength={128} onChange={(e) => setPassword(e.target.value)} />
              <StrengthMeter password={password} />
            </div>
          )}
        </AuthField>
        <Turnstile ref={turnstile} onToken={setToken} action="register" />
        <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={busy}>
          Create account
        </Button>
        <p className="text-center text-[11.5px] leading-4 text-fg-4">
          By continuing you agree to the{" "}
          <a href="https://opendesk.sh/terms" className="underline underline-offset-2 hover:text-fg-2">terms</a> and{" "}
          <a href="https://opendesk.sh/privacy" className="underline underline-offset-2 hover:text-fg-2">privacy policy</a>.
        </p>
      </form>
      <p className="mt-7 text-center text-[12.5px] text-fg-3">
        Already have an account?{" "}
        <Link to="/login" search={{ next: search.next }} className="font-medium text-fg hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
