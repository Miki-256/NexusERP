"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToasterProvider } from "@/components/ui/toast";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { OfflineProvider } from "@/components/offline/offline-provider";
import { SyncIndicator } from "@/components/offline/sync-indicator";
import { AppErrorBoundary } from "@/components/app-error-boundary";
import { DevRejectionFilter } from "@/components/dev-rejection-filter";
import { DevChunkRecovery } from "@/components/dev-chunk-recovery";
import { SessionBootLoader } from "@/components/ui/loading";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import { IntlProvider } from "@/components/i18n/intl-provider";
import type { AbstractIntlMessages } from "next-intl";
import type { AppLocale } from "@/i18n/config";

export function Providers({
  children,
  locale = "en",
  messages,
}: {
  children: React.ReactNode;
  locale?: AppLocale;
  messages?: AbstractIntlMessages;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      })
  );

  const tree = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <DevRejectionFilter />
        <DevChunkRecovery />
        <AppErrorBoundary>
          <OfflineProvider>
            <ToasterProvider>
              <RegisterServiceWorker />
              <SessionBootLoader />
              {children}
              <SyncIndicator />
            </ToasterProvider>
          </OfflineProvider>
        </AppErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  );

  if (!messages) return tree;

  return (
    <IntlProvider locale={locale} messages={messages}>
      {tree}
    </IntlProvider>
  );
}
