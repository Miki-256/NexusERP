"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter } from "next/navigation";

type NavigationContextValue = {
  isNavigating: boolean;
  pendingPath: string | null;
  navigate: (href: string) => void;
  markNavigating: (href: string) => void;
};

const NavigationContext = createContext<NavigationContextValue | null>(null);

/** Soft-nav feedback must never stick forever (blocks perceived taps on mobile). */
const PENDING_TIMEOUT_MS = 4_000;

function isInternalHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const prevPath = useRef(pathname);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPending = useCallback(() => {
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    setPendingPath(null);
  }, []);

  const armPending = useCallback(
    (href: string) => {
      setPendingPath(href);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(() => {
        setPendingPath(null);
        pendingTimer.current = null;
      }, PENDING_TIMEOUT_MS);
    },
    []
  );

  // Clear pending when navigation completes
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      clearPending();
    }
  }, [pathname, clearPending]);

  useEffect(() => () => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
  }, []);

  const markNavigating = useCallback(
    (href: string) => {
      armPending(href);
    },
    [armPending]
  );

  const navigate = useCallback(
    (href: string) => {
      if (href === pathname) return;
      armPending(href);
      startTransition(() => {
        router.push(href);
      });
    },
    [pathname, router, armPending]
  );

  // Global click capture — instant feedback before Next.js starts fetching RSC
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.download) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const href = anchor.getAttribute("href");
      if (!href || !isInternalHref(href)) return;

      const url = new URL(href, window.location.origin);
      if (url.pathname === pathname) return;

      armPending(url.pathname);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, armPending]);

  const isNavigating = isPending || pendingPath !== null;

  const value = useMemo(
    () => ({ isNavigating, pendingPath, navigate, markNavigating }),
    [isNavigating, pendingPath, navigate, markNavigating]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    return {
      isNavigating: false,
      pendingPath: null,
      navigate: (_href: string) => {},
      markNavigating: (_href: string) => {},
    };
  }
  return ctx;
}
