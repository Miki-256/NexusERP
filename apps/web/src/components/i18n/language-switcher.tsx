"use client";

import { useLocale, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALE_COOKIE, type AppLocale } from "@/i18n/config";
import { Languages } from "lucide-react";

function setLocaleCookie(locale: AppLocale) {
  document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
}

export function LanguageSwitcher({
  organizationId,
  compact = false,
}: {
  organizationId?: string;
  compact?: boolean;
}) {
  const t = useTranslations("common");
  const locale = useLocale() as AppLocale;

  async function selectLocale(next: AppLocale) {
    if (next === locale) return;
    setLocaleCookie(next);
    if (organizationId) {
      const supabase = createClient();
      await supabase
        .from("organizations")
        .update({ default_locale: next })
        .eq("id", organizationId);
    }
    // Full reload so root layout re-reads NEXT_LOCALE and loads am/en messages + font
    window.location.reload();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          className="touch-target"
          aria-label={t("language")}
        >
          <Languages className="h-4 w-4" />
          {!compact && (
            <span className="ml-1.5 hidden sm:inline">{locale === "am" ? t("amharic") : t("english")}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void selectLocale("en")}>{t("english")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void selectLocale("am")}>{t("amharic")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function applyLocaleCookie(locale: AppLocale) {
  setLocaleCookie(locale);
}
