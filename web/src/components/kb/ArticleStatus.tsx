import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { KbArticle } from "@/lib/api/types";

/** Draft and published in their tones, so lists scan by state. */
export function ArticleStatus({ status }: { status: KbArticle["status"] }) {
  const { t } = useTranslation("kb");
  return (
    <Badge tone={status === "published" ? "green" : "amber"} dot>
      {status === "published" ? t("status.published") : t("status.draft")}
    </Badge>
  );
}
