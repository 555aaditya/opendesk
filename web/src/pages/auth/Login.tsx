import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { MfaStep } from "@/components/auth/MfaStep";
import { AuthField, completeSignIn, Notice, oauthErrorMessage, OrDivider, PasswordInput, ProviderButtons } from "@/components/auth/parts";
import { Turnstile, type TurnstileHandle } from "@/components/auth/Turnstile";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";
import type { TokenResponse } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { track } from "@/lib/analytics";

const route = getRouteApi("/auth/login");

export default function Login() {
  const search = route.useSearch();
  const router = useRouter();
  const { data: cfg, isLoading } = useQuery(q.authConfig());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthErrorMessage(search.error));
  const [mfa, setMfa] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const finish = async (tok: TokenResponse) => {
    track("login_succeeded", { method: "password" });
    router.history.push(await completeSignIn(tok, search.next));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.login({ email: email.trim(), password, turnstile_token: token ?? undefined });
      if ("mfa_required" in r) {
        setMfa(r.mfa_token);
        setBusy(false);
        return;
      }
      await finish(r);
    } catch (err) {
      setBusy(false);
      turnstile.current?.reset();
      if (isApiError(err, "invalid_credentials") || (isApiError(err) && err.status === 401)) setError("Wrong email or password.");
      else if (isApiError(err, "captcha_failed")) setError("We couldn't verify you're human. Try the check again.");
      else setError(errorMessage(err));
    }
  };

  if (mfa) return <MfaStep mfaToken={mfa} onDone={finish} onBack={() => { setMfa(null); setPassword(""); }} />;

  const passwordLogin = cfg?.password_login ?? true;

  return (
    <div>
      <AuthHeading title="Log in to opendesk" subtitle="Welcome back. Pick up where your team left off." />
      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 rounded-md" />
          <Skeleton className="h-9 rounded-md" />
          <Skeleton className="h-9 rounded-md" />
        </div>
      ) : (
        <>
          <ProviderButtons next={search.next} />
          {passwordLogin && !!cfg?.providers.length && <OrDivider />}
          {error && <Notice className="mb-4">{error}</Notice>}
          {passwordLogin && (
            <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
              <AuthField label="Email">
                {(id) => (
                  <TextInput id={id} className="h-9" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
                )}
              </AuthField>
              <AuthField
                label="Password"
                aside={
                  <Link to="/forgot" className="text-xs text-fg-3 hover:text-fg">
                    Forgot password?
                  </Link>
                }
              >
                {(id) => <PasswordInput id={id} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
              </AuthField>
              <Turnstile ref={turnstile} onToken={setToken} action="login" />
              <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={busy}>
                Log in
              </Button>
            </form>
          )}
          {cfg?.signup_enabled !== false && (
            <p className="mt-7 text-center text-[12.5px] text-fg-3">
              New to opendesk?{" "}
              <Link to="/register" search={{ next: search.next }} className="font-medium text-fg hover:underline">
                Create an account
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
