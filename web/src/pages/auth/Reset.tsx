import { getRouteApi, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { AuthField, Notice, PasswordInput, StrengthMeter } from "@/components/auth/parts";
import { api } from "@/lib/api/endpoints";
import { errorMessage, isApiError } from "@/lib/api/client";

const route = getRouteApi("/auth/reset");

export default function Reset() {
  const { token } = route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token)
    return (
      <div>
        <AuthHeading title="This link is incomplete" subtitle="Open the reset link from your email again, or request a new one." />
        <Button variant="secondary" size="lg" className="w-full" asChild>
          <Link to="/forgot">Request a new link</Link>
        </Button>
      </div>
    );

  if (done)
    return (
      <div>
        <span className="mb-5 flex size-10 items-center justify-center rounded-lg bg-inverse text-inverse-fg">
          <Check className="size-[18px]" strokeWidth={2.5} />
        </span>
        <AuthHeading title="Password updated" subtitle="You were signed out everywhere. Log in with your new password." />
        <Button variant="primary" size="lg" className="w-full" asChild>
          <Link to="/login">Log in</Link>
        </Button>
      </div>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 12) return setError("Use at least 12 characters.");
    if (password !== confirm) return setError("The passwords don't match.");
    setBusy(true);
    try {
      await api.auth.reset(token, password);
      setDone(true);
    } catch (err) {
      if (isApiError(err) && (err.code === "invalid_token" || err.code === "not_found")) setError("This reset link has expired or was already used. Request a new one.");
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <AuthHeading title="Choose a new password" subtitle="Use 12 or more characters. A short sentence works well." />
      {error && <Notice className="mb-4">{error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AuthField label="New password">
          {(id) => (
            <div className="flex flex-col gap-2">
              <PasswordInput id={id} autoFocus autoComplete="new-password" value={password} maxLength={128} onChange={(e) => setPassword(e.target.value)} />
              <StrengthMeter password={password} />
            </div>
          )}
        </AuthField>
        <AuthField label="Confirm password">
          {(id) => <PasswordInput id={id} autoComplete="new-password" value={confirm} maxLength={128} onChange={(e) => setConfirm(e.target.value)} />}
        </AuthField>
        <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={busy}>
          Update password
        </Button>
      </form>
    </div>
  );
}
