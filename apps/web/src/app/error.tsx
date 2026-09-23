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

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Page failed to load</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Something went wrong loading this screen. Try again, or reload the page. If it keeps
        happening, sign out and sign back in.
      </p>
      {isDev && (
        <p className="max-w-lg text-xs text-muted-foreground">
          Developers: stop every running dev server, then in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">apps/web</code> run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">PORT=3003 npm run dev:fresh</code>. Do not
          run <code className="rounded bg-muted px-1.5 py-0.5">dev:clean</code> while a server is
          still running.
          {error?.message ? (
            <>
              <br />
              <span className="mt-2 block font-mono text-[11px] text-destructive">{error.message}</span>
            </>
          ) : null}
        </p>
      )}
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
