"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PageLoader } from "@/components/ui/loading/page-loader";
import { SESSION_BOOT_KEY } from "@/lib/session-redirect";

const MIN_VISIBLE_MS = 400;
const MAX_VISIBLE_MS = 2_500;

/** Show branded overlay once after sign-in / org switch until first route settles. */
export function SessionBootLoader() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const bootPath = useRef<string | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_BOOT_KEY) === "1") {
        bootPath.current = pathname;
        setVisible(true);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  useEffect(() => {
    if (!visible) return;

    const dismiss = () => {
      setVisible(false);
      try {
        sessionStorage.removeItem(SESSION_BOOT_KEY);
      } catch {
        /* ignore */
      }
    };

    // Route settled after boot → dismiss quickly
    if (bootPath.current && pathname !== bootPath.current) {
      const t = window.setTimeout(dismiss, MIN_VISIBLE_MS);
      return () => window.clearTimeout(t);
    }

    const maxTimer = window.setTimeout(dismiss, MAX_VISIBLE_MS);
    return () => window.clearTimeout(maxTimer);
  }, [pathname, visible]);

  if (!visible) return null;

  // Never capture taps — a stuck boot screen must not freeze mobile.
  return (
    <PageLoader
      variant="boot"
      message="Preparing your workspace…"
      className="pointer-events-none"
    />
  );
}
