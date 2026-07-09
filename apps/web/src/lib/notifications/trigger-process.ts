/** Fire-and-forget: process queued notification events (Telegram, in-app, email). */
export function triggerNotificationProcess(): void {
  if (typeof window === "undefined") return;
  void fetch("/api/notifications/process", {
    method: "POST",
    credentials: "include",
    keepalive: true,
  }).catch(() => {
    /* cron / manual repair will catch up */
  });
}
