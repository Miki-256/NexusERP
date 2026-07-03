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

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <DevRejectionFilter />
        <DevChunkRecovery />
        <AppErrorBoundary>
          <OfflineProvider>
            <ToasterProvider>
              <SessionBootLoader />
              {children}
              <SyncIndicator />
            </ToasterProvider>
          </OfflineProvider>
        </AppErrorBoundary>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
