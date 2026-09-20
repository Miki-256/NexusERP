"use client";

import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "next-intl";
import type { AppLocale } from "@/i18n/config";

export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: AppLocale;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      key={locale}
      locale={locale}
      messages={messages}
      timeZone="Africa/Addis_Ababa"
      onError={(error) => {
        if (error.code === "MISSING_MESSAGE" && process.env.NODE_ENV !== "development") return;
        console.warn(error);
      }}
      getMessageFallback={({ namespace, key }) => [namespace, key].filter(Boolean).join(".")}
    >
      {children}
    </NextIntlClientProvider>
  );
}
