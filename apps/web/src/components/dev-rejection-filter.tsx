"use client";

import { useEffect } from "react";

/**
 * Next.js 15 dev overlay treats script/style load failures as unhandled
 * rejections with reason `[object Event]`. Suppress those only — real Errors
 * still surface normally.
 */
export function DevRejectionFilter() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    function onUnhandledRejection(ev: PromiseRejectionEvent) {
      if (ev.reason instanceof Event) {
        ev.preventDefault();
      }
    }

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }, []);

  return null;
}
