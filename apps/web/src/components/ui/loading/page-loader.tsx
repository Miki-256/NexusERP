"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type PageLoaderVariant = "login" | "boot" | "default";

const TIP_INTERVAL_MS = 2_200;

const LOGIN_TIP_KEYS = ["loginTip1", "loginTip2", "loginTip3"] as const;
const BOOT_TIP_KEYS = ["bootTip1", "bootTip2", "bootTip3"] as const;

export function PageLoader({
  message = "Loading workspace…",
  variant = "default",
  className,
}: {
  message?: string;
  variant?: PageLoaderVariant;
  className?: string;
}) {
  const t = useTranslations("auth");
  const [tipIndex, setTipIndex] = useState(0);

  const tipKeys = variant === "login" ? LOGIN_TIP_KEYS : variant === "boot" ? BOOT_TIP_KEYS : null;
  const tipCount = tipKeys?.length ?? 0;

  useEffect(() => {
    if (tipCount < 2) return;
    const id = window.setInterval(() => {
      setTipIndex((i) => (i + 1) % tipCount);
    }, TIP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [tipCount]);

  const statusText = tipKeys ? t(tipKeys[tipIndex % tipKeys.length]) : message;

  return (
    <div
      className={cn(
        "nexus-session-loader fixed inset-0 z-[200] flex items-center justify-center overflow-hidden",
        className
      )}
      role="alert"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="nexus-session-ambient" aria-hidden>
        <span className="nexus-session-blob nexus-session-blob-a" />
        <span className="nexus-session-blob nexus-session-blob-b" />
        <span className="nexus-session-blob nexus-session-blob-c" />
      </div>

      <div className="nexus-page-loader-card relative z-[1] flex flex-col items-center gap-5 px-10 py-9">
        <div className="nexus-session-mark relative flex h-20 w-20 items-center justify-center nexus-stagger-item">
          <span className="nexus-orbit absolute -inset-1 rounded-full border border-primary/20" aria-hidden />
          <span
            className="nexus-orbit nexus-orbit-delay absolute inset-0 rounded-full border border-primary/35"
            aria-hidden
          />
          <span className="nexus-session-mark-core relative flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/25">
            N
          </span>
        </div>

        <div className="nexus-stagger-item text-center" style={{ animationDelay: "80ms" }}>
          <p
            key={statusText}
            className="nexus-session-tip font-heading text-sm font-semibold tracking-tight text-foreground"
          >
            {statusText}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Nexus ERP</p>
        </div>

        <div
          className="nexus-stagger-item h-0.5 w-36 overflow-hidden rounded-full bg-muted"
          style={{ animationDelay: "140ms" }}
        >
          <div className="nexus-loader-bar h-full w-1/2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)]" />
        </div>
      </div>
    </div>
  );
}
