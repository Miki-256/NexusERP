"use client";

export const SESSION_BOOT_KEY = "nexus_session_boot";

export function markSessionBoot() {
  try {
    sessionStorage.setItem(SESSION_BOOT_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Hard full-page navigation after auth. Never await work before calling this. */
export function completeSessionRedirect(href: string) {
  markSessionBoot();
  const target = new URL(href, window.location.origin).href;

  // Synchronous assign — most reliable across browsers and Next.js/Turbopack.
  window.location.href = target;

  window.setTimeout(() => {
    if (window.location.pathname.startsWith("/login")) {
      window.location.replace(target);
    }
  }, 250);

  window.setTimeout(() => {
    if (window.location.pathname.startsWith("/login")) {
      window.location.assign(target);
    }
  }, 800);
}
