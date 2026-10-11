import { Link, useNavigate } from "@tanstack/react-router";
import { AuthHeading } from "@/app/AuthLayout";
import { OnboardingSteps } from "@/components/auth/OnboardingSteps";
import { AddMailboxWizard } from "@/components/mailboxes/AddMailboxWizard";

export default function Mailbox() {
  const navigate = useNavigate();
  const toInbox = () => void navigate({ to: "/inbox/$folder/{-$ticketId}", params: { folder: "unassigned", ticketId: undefined } });
  return (
    <div>
      <OnboardingSteps current={2} />
      <AuthHeading title="Connect your first mailbox" subtitle="Mail sent to this address becomes tickets your team can answer together." />
      <AddMailboxWizard
        compact
        onDone={toInbox}
        extraFooter={
          <Link
            to="/inbox/$folder/{-$ticketId}"
            params={{ folder: "unassigned", ticketId: undefined }}
            className="rounded-md px-2 py-1 text-[12.5px] text-fg-3 hover:bg-hover hover:text-fg"
          >
            Skip for now
          </Link>
        }
      />
    </div>
  );
}
