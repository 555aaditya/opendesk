// Settings > AI agent > Behaviour, "Email": the mailboxes where Ollie answers
// emails (contracts/agent.md "Email"). The setting lives on each mailbox; this
// lists them and links there.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Section } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssistantName } from "@/components/tickets/ollie";
import { q } from "@/lib/queries";
import { AI_TONE, tone } from "@/lib/tones";
import { cn } from "@/lib/cn";

export function EmailMailboxes() {
  const { t } = useTranslation("agent");
  const name = useAssistantName();
  const { data, isLoading } = useQuery(q.mailboxes());
  const on = (data ?? []).filter((m) => m.ai_answers).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Section flush title={t("email.title")} description={t("email.description", { name })}>
      {isLoading ? (
        <div className="px-4 py-3">
          <Skeleton className="h-4 w-48" />
        </div>
      ) : !on.length ? (
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 text-[12.5px] text-fg-3">
          <span>{t("email.none", { name })}</span>
          <Link to="/settings/mailboxes" className="shrink-0 font-medium text-fg-2 underline decoration-line-strong underline-offset-2 hover:text-fg">
            {t("email.openMailboxes")}
          </Link>
        </div>
      ) : (
        <ul>
          {on.map((m) => (
            <li key={m.id} className="border-b border-line-soft last:border-0">
              <Link
                to="/settings/mailboxes/$mailboxId"
                params={{ mailboxId: m.id }}
                className="group flex items-center gap-3 px-4 py-2.5 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
              >
                <Mail className="size-3.5 shrink-0 text-fg-3" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-fg">{m.name}</span>
                  <span className="block truncate font-mono text-[11.5px] text-fg-3">{m.email}</span>
                </span>
                <span className={cn("inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11px] font-medium", tone[AI_TONE].soft, tone[AI_TONE].text)}>
                  {m.ai_answers_mode === "send" ? t("email.send") : t("email.draft")}
                </span>
                {m.ai_answers_outside_hours && <span className="hidden shrink-0 text-[11.5px] text-fg-3 sm:inline">{t("email.outsideHours")}</span>}
                <ChevronRight className="size-3.5 shrink-0 text-fg-4 transition-colors group-hover:text-fg-2" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
