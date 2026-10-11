import { useNavigate } from "@tanstack/react-router";
import { BackLink, NoAccess, SettingsPage } from "@/components/layout";
import { AddMailboxWizard } from "@/components/mailboxes/AddMailboxWizard";
import { atLeast, useRole } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { limitDetail, showLimit } from "@/components/billing/PlanLimit";
import { useLimit } from "@/components/billing/hooks";

export default function MailboxNew() {
  const navigate = useNavigate();
  const role = useRole();
  const limit = useLimit("mailboxes");
  return (
    <SettingsPage
      title="Add a mailbox"
      description="Choose how mail reaches opendesk. You can change the details later."
      back={<BackLink to="/settings/mailboxes">Mailboxes</BackLink>}
    >
      {atLeast(role, "admin") && limit.atLimit ? (
        <div className="rounded-lg border border-line">
          <EmptyState
            lit={2}
            title="You've reached a Free plan limit"
            description={limitDetail("mailboxes", limit.max)}
            action={
              <Button variant="primary" onClick={() => showLimit("mailboxes", limit.max)}>
                Upgrade to Pro
              </Button>
            }
          />
        </div>
      ) : atLeast(role, "admin") ? (
        <AddMailboxWizard
          onCancel={() => void navigate({ to: "/settings/mailboxes" })}
          onDone={(m) =>
            m ? void navigate({ to: "/settings/mailboxes/$mailboxId", params: { mailboxId: m.id } }) : void navigate({ to: "/settings/mailboxes" })
          }
        />
      ) : (
        <NoAccess what="mailboxes" />
      )}
    </SettingsPage>
  );
}
