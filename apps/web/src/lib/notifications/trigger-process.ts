/** Notifications are processed by the process-queue cron (every 5 min). No client trigger. */
export function triggerNotificationProcess(): void {
  /* no-op — /api/notifications/process requires cron secret; use process-queue cron */
}
