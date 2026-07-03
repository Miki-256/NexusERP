"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { captureException } from "@/lib/monitoring";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";

export default function TenantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { tags: { surface: "tenant-error" }, extra: { digest: error.digest } });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Workspace failed to load</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Something went wrong loading this page. Try again, or return through the workspace bootstrap
        if you just signed in.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={reset}>
          Try again
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href={POST_AUTH_BOOTSTRAP_PATH}>Re-open workspace</Link>
        </Button>
        <Button type="button" variant="outline" onClick={() => window.location.assign("/login")}>
          Sign in again
        </Button>
      </div>
    </div>
  );
}
