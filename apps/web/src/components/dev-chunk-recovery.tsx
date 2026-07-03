"use client";

import { useEffect } from "react";

const RELOAD_KEY = "nexus-dev-chunk-reload";

function isChunkLoadFailure(reason: unknown, message?: string): boolean {
  const text =
    message ??
    (reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "");

  return (
    /loading chunk .* failed/i.test(text) ||
    /chunkloaderror/i.test(text) ||
    /failed to fetch dynamically imported module/i.test(text) ||
    /importing a module script failed/i.test(text)
  );
}

/**
 * Dev-only: when webpack/turbopack serves new chunks after edits, the browser may
 * still request old hashed files → 404 → React/CSS never load (plain HTML page).
 * Hard-reload once to recover automatically.
 */
export function DevChunkRecovery() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    function reloadOnce() {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, "1");
      const url = new URL(window.location.href);
      url.searchParams.set("_nc", String(Date.now()));
      window.location.replace(url.toString());
    }

    function onError(ev: ErrorEvent) {
      if (isChunkLoadFailure(ev.error, ev.message)) reloadOnce();
    }

    function onUnhandledRejection(ev: PromiseRejectionEvent) {
      if (isChunkLoadFailure(ev.reason)) reloadOnce();
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
