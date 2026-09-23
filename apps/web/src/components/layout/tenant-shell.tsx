"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AppHeader } from "@/components/layout/app-header";
import { ShellProvider } from "@/components/layout/shell-context";
import { NavigationProvider, useNavigation } from "@/components/layout/navigation-context";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { SidebarPlaceholder } from "@/components/layout/sidebar-placeholder";
import type { SerializedNavApp } from "@/lib/apps-registry";
import type { WorkspaceSummary } from "@/lib/active-org";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { PlatformBannerLoader } from "@/components/layout/platform-banner-loader";
import { SupportSessionBanner } from "@/components/layout/support-session-banner";
import { LocaleBootstrap } from "@/components/i18n/locale-bootstrap";
import { InteractionRecovery } from "@/components/layout/interaction-recovery";
import type { ActiveSupportSession } from "@/lib/admin-types";
import { cn } from "@/lib/utils";

const Sidebar = dynamic(
  () =>
    import("@/components/layout/sidebar").then((m) => {
      if (!m.Sidebar) throw new Error("Sidebar export missing");
      return { default: m.Sidebar };
    }),
  { ssr: false, loading: () => <SidebarPlaceholder /> }
);

function MainContent({ children }: { children: React.ReactNode }) {
  const { isNavigating } = useNavigation();
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);
  const scrollSnapshotRef = useRef(0);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const onScroll = () => {
      scrollSnapshotRef.current = main.scrollTop;
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const pathnameChanged = pathname !== pathnameRef.current;
    pathnameRef.current = pathname;

    if (pathnameChanged) {
      scrollSnapshotRef.current = 0;
      return;
    }

    const target = scrollSnapshotRef.current;
    if (target <= 0) return;

    const restore = () => {
      main.scrollTop = target;
    };
    restore();
    requestAnimationFrame(restore);
  }, [children, pathname]);

  return (
    <main
      ref={mainRef}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-pb-mobile-nav"
    >
      {isNavigating && (
        <div
          className="pointer-events-none absolute inset-0 z-10 bg-background/10"
          aria-hidden
        />
      )}
      {/* Avoid padding shorthand here — it overrides pb-mobile-nav on small screens. */}
      <div
        className={cn(
          "relative mx-auto max-w-[1400px] px-3 pt-2 pb-mobile-nav transition-opacity duration-150 ease-out sm:px-4 sm:pt-3 lg:px-5 lg:pb-4 lg:pt-3",
          isNavigating && "opacity-80"
        )}
      >
        {children}
      </div>
    </main>
  );
}

export function TenantShell({
  orgName,
  activeOrganizationId,
  orgDefaultLocale,
  workspaces,
  userId,
  userEmail,
  userRole,
  canManageTeam,
  accessibleAppIds,
  navApps,
  supportSession = null,
  children,
}: {
  orgName: string;
  activeOrganizationId: string;
  orgDefaultLocale?: string | null;
  workspaces: WorkspaceSummary[];
  userId: string;
  userEmail?: string | null;
  userRole: string;
  canManageTeam: boolean;
  accessibleAppIds: string[];
  navApps: SerializedNavApp[];
  supportSession?: ActiveSupportSession | null;
  children: React.ReactNode;
}) {
  return (
    <NavigationProvider>
      <NavigationProgress />
      <ShellProvider>
        <LocaleBootstrap orgDefaultLocale={orgDefaultLocale} />
        <InteractionRecovery />
        <div className="flex min-h-screen bg-background">
          <Sidebar orgName={orgName} userId={userId} navApps={navApps} />
          <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <PlatformBannerLoader />
            {supportSession && <SupportSessionBanner session={supportSession} />}
            <AppHeader
              orgName={orgName}
              activeOrganizationId={activeOrganizationId}
              workspaces={workspaces}
              userEmail={userEmail}
              userRole={userRole}
              canManageTeam={canManageTeam}
              accessibleAppIds={accessibleAppIds}
            />
            <MainContent>{children}</MainContent>
            <MobileBottomNav accessibleAppIds={accessibleAppIds} />
          </div>
        </div>
      </ShellProvider>
    </NavigationProvider>
  );
}
