import { SidebarPlaceholder } from "@/components/layout/sidebar-placeholder";

/** Static shell streamed while tenant auth resolves — improves TTFB vs blocking layout. */
export function TenantAuthFallback() {
  return (
    <div className="flex min-h-screen bg-background">
      <SidebarPlaceholder />
      <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="h-14 shrink-0 border-b border-border bg-header" aria-hidden />
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          <div className="relative mx-auto max-w-[1400px] p-3 pb-mobile-nav sm:p-5 lg:p-7" />
        </main>
      </div>
    </div>
  );
}
