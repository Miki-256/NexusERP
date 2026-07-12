import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

/** Dev-only Sentry smoke test. GET /api/dev/sentry-test (or ?mode=throw) */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const mode = new URL(request.url).searchParams.get("mode");

  if (mode === "throw") {
    throw new Error("Sentry test error (unhandled) — delete me");
  }

  Sentry.captureException(new Error("Sentry test error (captured) — delete me"));
  return NextResponse.json({
    ok: true,
    message: "Test error sent to Sentry. Check https://sentry.io/issues/ within ~30s.",
  });
}
