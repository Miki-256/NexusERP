export type EmailChannelConfig = {
  is_enabled?: boolean;
  from_name?: string;
  from_email?: string;
  reply_to?: string | null;
};

export type EmailSenderEnv = {
  defaultFromEmail?: string;
  defaultFromName?: string;
};

export function validateEmailChannelConfig(
  config: EmailChannelConfig
): { ok: true } | { ok: false; error: string } {
  if (!config.is_enabled) {
    return { ok: false, error: "Email channel is disabled for this organization" };
  }
  return { ok: true };
}

export function resolveEmailSender(
  config: EmailChannelConfig,
  env: EmailSenderEnv = {}
): { ok: true; from: string; replyTo?: string } | { ok: false; error: string } {
  const enabled = validateEmailChannelConfig(config);
  if (!enabled.ok) return enabled;

  const fromEmail = config.from_email || env.defaultFromEmail;
  if (!fromEmail) {
    return {
      ok: false,
      error: "No from email configured (org channel settings or NOTIFICATION_FROM_EMAIL)",
    };
  }

  const fromName = config.from_name || env.defaultFromName || "NexusERP";
  return {
    ok: true,
    from: `${fromName} <${fromEmail}>`,
    replyTo: config.reply_to ?? undefined,
  };
}
