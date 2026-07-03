"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

function isInternalHref(href: string) {
  return href.startsWith("/") && !href.startsWith("//");
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const prevPath = useRef(pathname);

  // Clear pending when navigation completes
  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      setPendingPath(null);
    }
  }, [pathname]);

  const markNavigating = useCallback((href: string) => {
    setPendingPath(href);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      if (href === pathname) return;
      setPendingPath(href);
      startTransition(() => {
        router.push(href);
      });
    },
    [pathname, router]
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

      setPendingPath(url.pathname);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  const isNavigating = isPending || pendingPath !== null;

  return (
    <NavigationContext.Provider value={{ isNavigating, pendingPath, navigate, markNavigating }}>
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
