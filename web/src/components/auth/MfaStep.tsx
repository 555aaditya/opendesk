import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/client";
import type { TokenResponse } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { AuthHeading } from "@/app/AuthLayout";
import { Notice } from "./parts";

/** Six boxes over one real input: paste, autofill and screen readers just work. */
export function OtpInput({ value, onChange, onComplete, disabled, invalid }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; invalid?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="6-digit code"
        aria-invalid={invalid || undefined}
        maxLength={6}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          onChange(v);
          if (v.length === 6) onComplete?.(v);
        }}
        className="absolute inset-0 z-10 w-full cursor-text opacity-0"
      />
      <div className="flex gap-2" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => {
          const active = focused && (i === value.length || (i === 5 && value.length === 6));
          return (
            <div
              key={i}
              className={cn(
                "mono flex h-12 flex-1 items-center justify-center rounded-md border bg-surface text-[20px] font-medium tabular-nums transition-[border-color,box-shadow] duration-100",
                invalid ? "border-danger" : active ? "border-fg-3 shadow-[0_0_0_3px_var(--focus)]" : "border-line",
                i === 2 && "mr-2",
              )}
            >
              {value[i] ?? (active ? <span className="h-5 w-px animate-pulse-soft bg-fg" /> : "")}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MfaStep({ mfaToken, onDone, onBack }: { mfaToken: string; onDone: (t: TokenResponse) => void | Promise<void>; onBack: () => void }) {
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recoveryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "recovery") recoveryRef.current?.focus();
  }, [mode]);

  const submit = async (value = code) => {
    const v = value.trim();
    if (mode === "totp" && v.length !== 6) return;
    if (mode === "recovery" && v.length < 8) return setError("Enter a recovery code.");
    setBusy(true);
    setError(null);
    try {
      const tok = await api.auth.mfa({ mfa_token: mfaToken, code: v });
      await onDone(tok);
    } catch (e) {
      setCode("");
      if (isApiError(e, "rate_limited")) setError("Too many attempts. Wait a moment and try again.");
      else if (isApiError(e) && e.status === 401 && e.code !== "invalid_code") setError("This sign-in expired. Start again.");
      else setError(mode === "totp" ? "That code didn't work. Check your app and try again." : "That recovery code didn't work.");
      setBusy(false);
    }
  };

  return (
    <div>
      <AuthHeading
        title="Two-factor authentication"
        subtitle={mode === "totp" ? "Enter the 6-digit code from your authenticator app." : "Enter one of the recovery codes you saved when you set up 2FA."}
      />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {mode === "totp" ? (
          <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => void submit(v)} disabled={busy} invalid={!!error} />
        ) : (
          <TextInput
            ref={recoveryRef}
            className="mono h-9 tracking-[0.04em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            aria-label="Recovery code"
            autoComplete="off"
            spellCheck={false}
          />
        )}
        {error && <Notice>{error}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={mode === "totp" && code.length !== 6}>
          Verify
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between text-[12.5px]">
        <button type="button" onClick={onBack} className="text-fg-3 hover:text-fg">
          Back
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "totp" ? "recovery" : "totp");
            setCode("");
            setError(null);
          }}
          className="text-fg-3 underline decoration-line-strong underline-offset-2 hover:text-fg"
        >
          {mode === "totp" ? "Use a recovery code" : "Use your authenticator app"}
        </button>
      </div>
    </div>
  );
}
