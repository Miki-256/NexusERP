"use client";

import { createContext, useContext, useEffect, useState } from "react";

type ShellContextValue = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
};

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("nexus-sidebar-collapsed");
    if (stored === "true") setSidebarCollapsed(true);
  }, []);

  function setCollapsed(v: boolean) {
    setSidebarCollapsed(v);
    localStorage.setItem("nexus-sidebar-collapsed", String(v));
  }

  return (
    <ShellContext.Provider
      value={{
        sidebarCollapsed,
        setSidebarCollapsed: setCollapsed,
        toggleSidebar: () => setCollapsed(!sidebarCollapsed),
        mobileOpen,
        setMobileOpen,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}

export function useShell() {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within ShellProvider");
  return ctx;
}
