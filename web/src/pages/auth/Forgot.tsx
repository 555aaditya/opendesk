import { Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useRef, useState } from "react";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { AuthField, Notice } from "@/components/auth/parts";
import { Turnstile, type TurnstileHandle } from "@/components/auth/Turnstile";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    setBusy(true);
    setError(null);
    try {
      await api.auth.forgot(email.trim(), token ?? undefined);
      setSent(true);
    } catch (err) {
      turnstile.current?.reset();
      // The answer is the same for every address; only transport problems surface.
      if (isApiError(err, "rate_limited") || isApiError(err, "network_error") || isApiError(err, "captcha_failed")) setError(errorMessage(err));
      else setSent(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <div>
        <span className="mb-5 flex size-10 items-center justify-center rounded-lg border border-line text-fg-2">
          <MailCheck className="size-[18px]" />
        </span>
        <AuthHeading title="Check your email" subtitle={<>If an account exists for <span className="font-medium text-fg">{email.trim()}</span>, we sent a link to reset its password. It expires in an hour.</>} />
        <Button variant="secondary" size="lg" className="w-full" asChild>
          <Link to="/login">Back to log in</Link>
        </Button>
        <button type="button" onClick={() => setSent(false)} className="mt-4 w-full text-center text-[12.5px] text-fg-3 hover:text-fg">
          Use a different email
        </button>
      </div>
    );

  return (
    <div>
      <AuthHeading title="Reset your password" subtitle="Enter the email you use for opendesk and we'll send you a reset link." />
      {error && <Notice className="mb-4">{error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AuthField label="Email">
          {(id) => <TextInput id={id} className="h-9" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />}
        </AuthField>
        <Turnstile ref={turnstile} onToken={setToken} action="password_reset" />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Send reset link
        </Button>
      </form>
      <p className="mt-7 text-center text-[12.5px] text-fg-3">
        Remembered it?{" "}
        <Link to="/login" className="font-medium text-fg hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
