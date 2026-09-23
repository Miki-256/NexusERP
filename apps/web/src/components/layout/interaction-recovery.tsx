"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Radix Dialog/Sheet set `pointer-events: none` on <body> while open.
 * If a modal unmounts mid-navigation (common on mobile), body can stay locked and
 * the whole app becomes untappable. Clear locks on route change, resume, and a failsafe.
 */
function hasOpenModal() {
  return Boolean(
    document.querySelector(
      "[data-radix-dialog-content][data-state='open'], [role='dialog'][data-state='open'], [data-state='open'][data-radix-menu-content]"
    )
  );
}

function clearBodyInteractionLocks() {
  if (typeof document === "undefined") return;
  const body = document.body;
  const html = document.documentElement;

  if (body.style.pointerEvents === "none") {
    body.style.pointerEvents = "";
  }
  if (html.style.pointerEvents === "none") {
    html.style.pointerEvents = "";
  }

  // Radix RemoveScroll / react-remove-scroll leftovers
  body.removeAttribute("data-scroll-locked");
  html.removeAttribute("data-scroll-locked");
  body.style.removeProperty("padding-right");
  body.style.removeProperty("margin-right");
  body.style.removeProperty("overflow");
  body.removeAttribute("inert");
  html.removeAttribute("inert");

  // Orphaned closed overlays must not sit above the UI and eat taps
  if (!hasOpenModal()) {
    document.querySelectorAll("[data-radix-dialog-overlay]").forEach((el) => {
      if (el.getAttribute("data-state") !== "open") {
        (el as HTMLElement).style.pointerEvents = "none";
      }
    });
  }
}

export function InteractionRecovery() {
  const pathname = usePathname();

  useEffect(() => {
    clearBodyInteractionLocks();

    const unlockIfStale = () => {
      const locked =
        document.body.style.pointerEvents === "none" ||
        document.body.hasAttribute("data-scroll-locked") ||
        document.body.hasAttribute("inert");
      if (!locked) return;
      if (!hasOpenModal()) clearBodyInteractionLocks();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") unlockIfStale();
    };

    // Immediate unlock on first interaction if body is stale-locked
    const onPointer = () => unlockIfStale();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", unlockIfStale);
    document.addEventListener("pointerdown", onPointer, true);

    const id = window.setInterval(unlockIfStale, 1500);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", unlockIfStale);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [pathname]);

  return null;
}
