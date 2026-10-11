import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsPage, Section, Row } from "@/components/layout";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api/endpoints";
import type { User } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { updateUser, useSession } from "@/lib/session";
import { useTheme, type ThemePref } from "@/lib/theme";

export default function Profile() {
  const user = useSession((s) => s.user)!;
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState(user.avatar_url);
  useEffect(() => {
    setName(user.name);
    setAvatar(user.avatar_url);
  }, [user.name, user.avatar_url]);

  const dirty = name.trim() !== user.name || avatar.trim() !== user.avatar_url;
  const validAvatar = !avatar.trim() || /^https:\/\/\S+$/i.test(avatar.trim());

  const save = useMutation({
    mutationFn: () => api.me.update({ name: name.trim(), avatar_url: avatar.trim() }),
    onMutate: () => {
      const prev: User = user;
      updateUser({ ...user, name: name.trim(), avatar_url: avatar.trim() });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx) updateUser(ctx.prev);
      toast.error(e);
    },
    onSuccess: (u) => {
      updateUser(u);
      toast.success("Profile saved");
    },
  });

  const resend = useMutation({
    mutationFn: api.auth.resendVerification,
    onSuccess: () => toast.success("Verification email sent", { description: "Check your inbox for the link." }),
    onError: (e) => toast.error(e),
  });

  return (
    <SettingsPage title="Profile" description="How you appear to teammates in tickets, notes and mentions.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && name.trim() && validAvatar) save.mutate();
        }}
      >
        <Section>
          <Row label="Photo" description="An HTTPS image URL. Leave empty to use your initials.">
            <div className="flex items-center gap-3">
              <Avatar name={name || user.email} src={validAvatar ? avatar.trim() || null : null} size="xl" />
            </div>
          </Row>
          <Row label="Name" htmlFor="profile-name">
            <TextInput id="profile-name" className="w-[280px]" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Row>
          <Row label="Photo URL" htmlFor="profile-avatar">
            <TextInput
              id="profile-avatar"
              className="w-[280px]"
              value={avatar}
              invalid={!validAvatar}
              placeholder="https://"
              onChange={(e) => setAvatar(e.target.value)}
            />
          </Row>
          <Row
            label="Email"
            description={user.email_verified ? "Used to sign in and for notifications." : "Verify your email to receive notifications."}
          >
            <span className="mono text-[12.5px] text-fg-2">{user.email}</span>
            {user.email_verified ? (
              <Badge tone="ok">Verified</Badge>
            ) : (
              <Button size="xs" loading={resend.isPending} onClick={() => resend.mutate()}>
                Resend verification
              </Button>
            )}
          </Row>
        </Section>
        <div className="mt-3 flex justify-end gap-2">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setName(user.name);
                setAvatar(user.avatar_url);
              }}
            >
              Discard
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!dirty || !name.trim() || !validAvatar} loading={save.isPending}>
            Save changes
          </Button>
        </div>
      </form>

      <Section title="Appearance" description="Applies to this browser.">
        <div className="py-3">
          <ThemeCards />
        </div>
      </Section>
    </SettingsPage>
  );
}

function ThemeCards() {
  const { pref, setTheme } = useTheme();
  const opts: { value: ThemePref; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => setTheme(o.value)}
          className={cn(
            "group flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
            pref === o.value ? "border-fg-2 shadow-[0_0_0_1px_var(--fg-2)]" : "border-line hover:border-line-strong",
          )}
        >
          <ThemePreview kind={o.value} />
          <span className="flex items-center justify-between px-0.5 text-[12.5px] font-medium">
            {o.label}
            {pref === o.value && <Check className="size-3.5" />}
          </span>
        </button>
      ))}
    </div>
  );
}

function Mini({ dark }: { dark: boolean }) {
  const bg = dark ? "#0a0a0a" : "#fafafa";
  const panel = dark ? "#0f0f0f" : "#ffffff";
  const line = dark ? "#262626" : "#e4e4e4";
  const ink = dark ? "#fafafa" : "#0a0a0a";
  const muted = dark ? "#333333" : "#e4e4e4";
  return (
    <svg viewBox="0 0 120 72" className="h-full w-full" aria-hidden>
      <rect width="120" height="72" fill={bg} />
      <rect x="6" y="8" width="22" height="3" rx="1.5" fill={ink} opacity="0.8" />
      <rect x="6" y="16" width="18" height="2.5" rx="1.25" fill={muted} />
      <rect x="6" y="22" width="20" height="2.5" rx="1.25" fill={muted} />
      <rect x="6" y="28" width="15" height="2.5" rx="1.25" fill={muted} />
      <rect x="34" y="4" width="82" height="64" rx="4" fill={panel} stroke={line} />
      <rect x="40" y="12" width="40" height="3" rx="1.5" fill={ink} opacity="0.85" />
      <rect x="40" y="22" width="68" height="2.5" rx="1.25" fill={muted} />
      <rect x="40" y="28" width="60" height="2.5" rx="1.25" fill={muted} />
      <rect x="40" y="34" width="64" height="2.5" rx="1.25" fill={muted} />
      <rect x="86" y="54" width="24" height="8" rx="2" fill={ink} />
    </svg>
  );
}

function ThemePreview({ kind }: { kind: ThemePref }) {
  return (
    <span className="relative block aspect-[5/3] overflow-hidden rounded-md border border-line">
      {kind === "system" ? (
        <>
          <span className="absolute inset-0">
            <Mini dark={false} />
          </span>
          <span className="absolute inset-0 [clip-path:polygon(55%_0,100%_0,100%_100%,45%_100%)]">
            <Mini dark />
          </span>
        </>
      ) : (
        <Mini dark={kind === "dark"} />
      )}
    </span>
  );
}
