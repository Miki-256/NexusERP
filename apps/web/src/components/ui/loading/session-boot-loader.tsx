"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { PageLoader } from "@/components/ui/loading/page-loader";
import { SESSION_BOOT_KEY } from "@/lib/session-redirect";

const MIN_VISIBLE_MS = 600;
const MAX_VISIBLE_MS = 15_000;

/** Show branded overlay once after sign-in / org switch until first route settles. */
export function SessionBootLoader() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_BOOT_KEY) === "1") {
        setVisible(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!visible) return;

    const started = Date.now();
    let dismissed = false;

    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      setVisible(false);
      try {
        sessionStorage.removeItem(SESSION_BOOT_KEY);
      } catch {
        /* ignore */
      }
    };

    const minTimer = window.setTimeout(() => {
      const elapsed = Date.now() - started;
      const delay = Math.max(0, MIN_VISIBLE_MS - elapsed);
      window.setTimeout(dismiss, delay);
    }, 0);

    const maxTimer = window.setTimeout(dismiss, MAX_VISIBLE_MS);

    return () => {
      window.clearTimeout(minTimer);
      window.clearTimeout(maxTimer);
    };
  }, [pathname, visible]);

  if (!visible) return null;
  return <PageLoader message="Preparing your workspace…" />;
}
