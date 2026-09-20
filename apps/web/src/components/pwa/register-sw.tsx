"use client";

import { useEffect } from "react";

/**
 * Registers the root service worker so PWABuilder / Chromium see an installable PWA.
 * Production + localhost only (skip ephemeral preview hosts if needed later).
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const host = window.location.hostname;
    const allow =
      process.env.NODE_ENV === "production" ||
      host === "localhost" ||
      host === "127.0.0.1";
    if (!allow) return;

    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /* ignore — install still works without SW on modern Chromium */
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
