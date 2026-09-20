"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { applyLocaleCookie } from "@/components/i18n/language-switcher";
import { isAppLocale, LOCALE_COOKIE, type AppLocale } from "@/i18n/config";

/** When NEXT_LOCALE cookie is missing, apply org default_locale and reload. */
export function LocaleBootstrap({ orgDefaultLocale }: { orgDefaultLocale?: string | null }) {
  const locale = useLocale() as AppLocale;
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (!isAppLocale(orgDefaultLocale)) return;

    const hasCookie = document.cookie
      .split(";")
      .some((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));

    if (hasCookie) return;

    ran.current = true;
    applyLocaleCookie(orgDefaultLocale);
    if (orgDefaultLocale !== locale) {
      window.location.reload();
    }
  }, [orgDefaultLocale, locale]);

  return null;
}
