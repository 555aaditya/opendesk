import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

const tab =
  "inline-flex h-[26px] items-center rounded-md px-2.5 text-[12.5px] font-medium text-fg-3 transition-[color,background-color,box-shadow] duration-100 hover:text-fg";
const active = "bg-surface !text-fg shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(0_0_0/0.06)]";

/** Contacts / Companies switch shown in both page headers. */
export function DirectoryNav({ current }: { current: "contacts" | "companies" }) {
  const { t } = useTranslation("contacts");
  return (
    <nav aria-label={t("nav.label")} className="inline-flex items-center rounded-md bg-hover p-0.5">
      <Link
        to="/contacts/{-$contactId}"
        params={{ contactId: undefined }}
        search={{ q: undefined, company: undefined }}
        aria-current={current === "contacts" ? "page" : undefined}
        className={cn(tab, current === "contacts" && active)}
      >
        {t("nav.people")}
      </Link>
      <Link
        to="/companies/{-$companyId}"
        params={{ companyId: undefined }}
        search={{ q: undefined }}
        aria-current={current === "companies" ? "page" : undefined}
        className={cn(tab, current === "companies" && active)}
      >
        {t("nav.companies")}
      </Link>
    </nav>
  );
}
