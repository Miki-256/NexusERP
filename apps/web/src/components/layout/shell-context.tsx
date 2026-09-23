"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

type ShellContextValue = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

function readCollapsedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem("nexus-sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(readCollapsedPreference());
    setHydrated(true);
  }, []);

  // Close mobile drawer on route change so the dimmed backdrop never traps taps
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const setCollapsed = useCallback((v: boolean) => {
    setSidebarCollapsed(v);
    try {
      localStorage.setItem("nexus-sidebar-collapsed", String(v));
    } catch {
      /* ignore quota */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed(!sidebarCollapsed);
  }, [setCollapsed, sidebarCollapsed]);

  const value = useMemo(
    () => ({
      sidebarCollapsed: hydrated ? sidebarCollapsed : false,
      setSidebarCollapsed: setCollapsed,
      toggleSidebar,
      mobileOpen,
      setMobileOpen,
    }),
    [hydrated, sidebarCollapsed, setCollapsed, toggleSidebar, mobileOpen]
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  const ctx = useContext(ShellContext);
  // Do not throw — Suspense fallbacks / partial mounts can render outside ShellProvider.
  // Throwing here bricks the whole app with root error.tsx for cashiers.
  if (!ctx) {
    return {
      sidebarCollapsed: false,
      setSidebarCollapsed: () => {},
      toggleSidebar: () => {},
      mobileOpen: false,
      setMobileOpen: () => {},
    };
  }
  return ctx;
}
