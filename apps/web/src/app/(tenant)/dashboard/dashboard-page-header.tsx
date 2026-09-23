"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ShoppingCart, FileSpreadsheet } from "lucide-react";

export function DashboardPageHeader({
  orgName,
  canAccessAccounting,
}: {
  orgName?: string | null;
  canAccessAccounting: boolean;
}) {
  const t = useTranslations("dashboard");

  return (
    <PageHeader
      compact
      breadcrumb={t("breadcrumb")}
      title={t("titleWithOrg", { org: orgName?.trim() || t("workspace") })}
      description={canAccessAccounting ? t("descriptionAccounting") : t("descriptionBasic")}
      action={
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/reports">
              <FileSpreadsheet className="h-4 w-4" />
              {t("exportReports")}
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/pos">
              <ShoppingCart className="h-4 w-4" />
              {t("openPos")}
            </Link>
          </Button>
        </div>
      }
    />
  );
}
