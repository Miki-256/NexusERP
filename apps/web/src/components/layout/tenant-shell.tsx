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
import { cn } from "@/lib/utils";

const Sidebar = dynamic(
  () => import("@/components/layout/sidebar").then((m) => m.Sidebar),
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
    <main ref={mainRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      {isNavigating && (
        <div
          className="pointer-events-none absolute inset-0 z-10 bg-background/20 backdrop-blur-[1px]"
          aria-hidden
        />
      )}
      <div
        className={cn(
          "relative mx-auto max-w-[1400px] p-3 pb-mobile-nav transition-all duration-300 ease-out sm:p-5 lg:p-7",
          isNavigating && "scale-[0.998] opacity-60"
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
  workspaces,
  userId,
  userEmail,
  userRole,
  canManageTeam,
  accessibleAppIds,
  navApps,
  children,
}: {
  orgName: string;
  activeOrganizationId: string;
  workspaces: WorkspaceSummary[];
  userId: string;
  userEmail?: string | null;
  userRole: string;
  canManageTeam: boolean;
  accessibleAppIds: string[];
  navApps: SerializedNavApp[];
  children: React.ReactNode;
}) {
  return (
    <NavigationProvider>
      <NavigationProgress />
      <ShellProvider>
        <div className="flex min-h-screen bg-background">
          <Sidebar orgName={orgName} userId={userId} navApps={navApps} />
          <div className="flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <PlatformBannerLoader />
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
