"use client";

import { useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endSupportSession } from "@/app/actions/support-session";
import type { ActiveSupportSession } from "@/lib/admin-types";

export function SupportSessionBanner({ session }: { session: ActiveSupportSession }) {
  const [pending, startTransition] = useTransition();
  const expires = new Date(session.expires_at);

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:px-5">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-medium">Support session</span> on{" "}
            <span className="font-medium">{session.organization_name}</span>
            {" · "}
            {session.reason}
            {" · "}
            ends {expires.toLocaleString()}
          </span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-400 bg-white"
          disabled={pending}
          onClick={() => startTransition(() => void endSupportSession())}
        >
          {pending ? "Ending…" : "End support session"}
        </Button>
      </div>
    </div>
  );
}
