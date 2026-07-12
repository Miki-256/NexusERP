/** Batch size for notification worker pipeline (env override + hard cap). */
export function resolveNotificationBatchSize(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.max(1, Math.min(override, 200));
  }
  const fromEnv = Number(process.env.NOTIFICATION_BATCH_SIZE ?? 50);
  return Math.max(1, Math.min(Number.isFinite(fromEnv) ? fromEnv : 50, 200));
}
