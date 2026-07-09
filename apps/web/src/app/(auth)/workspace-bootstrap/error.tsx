"use client";

import { useEffect } from "react";
import { PageLoader } from "@/components/ui/loading";

/** Shown if navigation stalls on /workspace-bootstrap — forces client redirect to dashboard (or onboarding). */
export default function WorkspaceBootstrapErrorFallback() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (window.location.pathname === "/workspace-bootstrap") {
        window.location.replace("/dashboard");
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, []);

  return <PageLoader message="Opening your workspace…" />;
}
