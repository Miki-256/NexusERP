type CaptureContext = {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
};

let sentryReady: Promise<typeof import("@sentry/nextjs") | null> | null = null;

function loadSentry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN) {
    return Promise.resolve(null);
  }
  if (!sentryReady) {
    sentryReady = import("@sentry/nextjs").catch(() => null);
  }
  return sentryReady;
}

/** Report an error to Sentry when configured; always logs locally. */
export function captureException(error: unknown, context?: CaptureContext) {
  if (process.env.NODE_ENV !== "production") {
    console.error("[captureException]", error, context);
  }

  void loadSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.captureException(error, {
      tags: context?.tags,
      extra: context?.extra,
    });
  });
}

export function captureMessage(message: string, context?: CaptureContext) {
  if (process.env.NODE_ENV !== "production") {
    console.warn("[captureMessage]", message, context);
  }

  void loadSentry().then((Sentry) => {
    if (!Sentry) return;
    Sentry.captureMessage(message, {
      level: "warning",
      tags: context?.tags,
      extra: context?.extra,
    });
  });
}
