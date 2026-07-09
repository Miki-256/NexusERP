"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
  Monitor,
  ShoppingCart,
  Settings,
  User,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme/theme-provider";
import { useShell } from "@/components/layout/shell-context";
import { CommandPalette, useCommandPalette } from "@/components/layout/command-palette";
import { OrgSwitcher } from "@/components/layout/org-switcher";
import { NotificationInbox } from "@/components/notifications/notification-inbox";
import { createClient } from "@/lib/supabase/client";
import type { WorkspaceSummary } from "@/lib/active-org";
import { cn } from "@/lib/utils";

export function AppHeader({
  orgName,
  activeOrganizationId,
  workspaces,
  userEmail,
  userRole,
  canManageTeam,
  accessibleAppIds,
}: {
  orgName: string;
  activeOrganizationId: string;
  workspaces: WorkspaceSummary[];
  userEmail?: string | null;
  userRole: string;
  canManageTeam: boolean;
  accessibleAppIds: string[];
}) {
  const router = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { toggleSidebar, setMobileOpen } = useShell();
  const { open, setOpen } = useCommandPalette();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initials = (userEmail?.[0] ?? orgName[0] ?? "U").toUpperCase();

  return (
    <>
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-header-border bg-header px-3 sm:gap-3 sm:px-4 lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="touch-target shrink-0 lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden shrink-0 lg:inline-flex"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </Button>

        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Search"
          className={cn(
            "flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-md border border-input bg-muted/30 text-muted-foreground sm:hidden",
            "min-w-9 transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "hidden h-9 flex-1 max-w-md cursor-pointer items-center gap-2 rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground sm:flex",
            "transition-colors duration-150 hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">Search…</span>
          <kbd className="ml-auto hidden rounded border bg-background px-1.5 py-0.5 text-2xs font-medium md:inline">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
          <OrgSwitcher
            orgName={orgName}
            activeOrganizationId={activeOrganizationId}
            workspaces={workspaces}
            canManageTeam={canManageTeam}
          />

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                <span className="hidden md:inline">Quick actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              <DropdownMenuItem asChild>
                <Link href="/pos">
                  <ShoppingCart className="h-4 w-4" />
                  New sale (POS)
                </Link>
              </DropdownMenuItem>
              {canManageTeam && (
                <>
                  <DropdownMenuItem asChild>
                    <Link href="/invoicing">New invoice</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/expenses">Record expense</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/purchasing">Purchase order</Link>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <NotificationInbox organizationId={activeOrganizationId} />

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Theme">
                {resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="h-4 w-4" />
                Light
                {theme === "light" && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="h-4 w-4" />
                Dark
                {theme === "dark" && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Monitor className="h-4 w-4" />
                System
                {theme === "system" && <Check className="ml-auto h-4 w-4" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 pl-1.5 pr-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
                  {initials}
                </div>
                <ChevronDown className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-normal">
                  <p className="truncate text-sm font-medium">{userEmail ?? "User"}</p>
                  <p className="text-xs capitalize text-muted-foreground">{userRole}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <User className="h-4 w-4" />
                  Profile & settings
                </Link>
              </DropdownMenuItem>
              {canManageTeam && (
                <DropdownMenuItem asChild>
                  <Link href="/team">
                    <Settings className="h-4 w-4" />
                    Team management
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandPalette accessibleAppIds={accessibleAppIds} open={open} onOpenChange={setOpen} />
    </>
  );
}
