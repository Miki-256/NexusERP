"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/monitoring";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { tags: { surface: "app-error" }, extra: { digest: error.digest } });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Page failed to load</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The interface could not render. Refresh the page. Developers: if this persists after many
        edits, stop every running dev server, then in{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">apps/web</code> run{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">PORT=3003 npm run dev:fresh</code>.
        Do not run <code className="rounded bg-muted px-1.5 py-0.5 text-xs">dev:clean</code> while
        a dev server is still running.
      </p>
      <div className="flex gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
