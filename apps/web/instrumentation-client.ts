import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    enableLogs: true,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracePropagationTargets: [
      "localhost",
      /^\//,
      ...(appOrigin ? [new RegExp(`^${appOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api`)] : []),
    ],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
