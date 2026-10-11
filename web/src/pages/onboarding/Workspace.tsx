import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthHeading } from "@/app/AuthLayout";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/input";
import { AuthField, Notice, slugify } from "@/components/auth/parts";
import { OnboardingSteps } from "@/components/auth/OnboardingSteps";
import { api } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/client";
import { reloadSession, selectWorkspace, useSession, useWorkspace } from "@/lib/session";
import { track } from "@/lib/analytics";

export default function Workspace() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const current = useWorkspace();
  const hasWorkspaces = useSession((s) => s.memberships.length > 0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Give your workspace a name.");
    setBusy(true);
    setError(null);
    try {
      const ws = await api.workspaces.create(name.trim());
      await reloadSession(ws.id);
      selectWorkspace(ws.id);
      qc.clear();
      track("workspace_created");
      void navigate({ to: "/onboarding/mailbox" });
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };

  const host = location.host.includes("localhost") ? "app.opendesk.sh" : location.host;

  return (
    <div>
      {hasWorkspaces && current && (
        <Link to="/" className="-ml-1 mb-6 inline-flex h-6 items-center gap-0.5 rounded-md pl-0.5 pr-1.5 text-[12.5px] text-fg-3 hover:bg-hover hover:text-fg">
          <ChevronLeft className="size-3.5" />
          Back to {current.name}
        </Link>
      )}
      <OnboardingSteps current={1} />
      <AuthHeading title="Create your workspace" subtitle="A workspace holds your team's inboxes, contacts and help center. You can rename it later." />
      {error && <Notice className="mb-4">{error}</Notice>}
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <AuthField label="Workspace name">
          {(id) => <TextInput id={id} className="h-9" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Acme support" />}
        </AuthField>
        <div className="rounded-md border border-line bg-sunken px-3 py-2.5">
          <div className="text-[11.5px] text-fg-3">Your help center</div>
          <div className="mono mt-0.5 truncate text-[12.5px] text-fg-2">
            {host}/help/<span className="text-fg">{slugify(name)}</span>
          </div>
        </div>
        <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={busy}>
          Continue
        </Button>
      </form>
    </div>
  );
}
