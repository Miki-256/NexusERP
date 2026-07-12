/** Shared secret verification for cron/webhook/internal API routes. */
function serverEnv(key: string): string | undefined {
  return process.env[key];
}

export function verifyInternalSecret(request: Request): boolean {
  const webhookSecret = serverEnv("POS_WEBHOOK_SECRET")?.trim();
  const cronSecret = serverEnv("CRON_SECRET")?.trim();

  const headerSecret = request.headers.get("x-pos-webhook-secret")?.trim();
  if (webhookSecret && headerSecret === webhookSecret) return true;

  const auth = request.headers.get("authorization")?.trim();
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;

  if (!webhookSecret && !cronSecret) {
    return process.env.NODE_ENV !== "production";
  }

  return false;
}
