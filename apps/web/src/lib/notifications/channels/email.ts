import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedDelivery } from "../types";

export type EmailDeliveryResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

type EmailChannelConfig = {
  is_enabled?: boolean;
  from_name?: string;
  from_email?: string;
  reply_to?: string | null;
};

export async function deliverEmail(
  admin: SupabaseClient,
  delivery: ClaimedDelivery
): Promise<EmailDeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const { data: configRaw, error: configError } = await admin.rpc(
    "get_notification_email_config_internal",
    { p_org_id: delivery.organization_id }
  );
  if (configError) {
    return { ok: false, error: configError.message };
  }

  const config = (configRaw ?? {}) as EmailChannelConfig;
  if (!config.is_enabled) {
    return { ok: false, error: "Email channel is disabled for this organization" };
  }

  const fromEmail = config.from_email || process.env.NOTIFICATION_FROM_EMAIL;
  if (!fromEmail) {
    return {
      ok: false,
      error: "No from email configured (org channel settings or NOTIFICATION_FROM_EMAIL)",
    };
  }

  const fromName =
    config.from_name || process.env.NOTIFICATION_FROM_NAME || "NexusERP";
  const from = `${fromName} <${fromEmail}>`;

  const resend = new Resend(apiKey);
  const subject = delivery.subject ?? "(no subject)";
  const { data, error } =
    delivery.body_format === "html"
      ? await resend.emails.send({
          from,
          to: delivery.recipient_ref,
          subject,
          html: delivery.body,
          replyTo: config.reply_to ?? undefined,
        })
      : await resend.emails.send({
          from,
          to: delivery.recipient_ref,
          subject,
          text: delivery.body,
          replyTo: config.reply_to ?? undefined,
        });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, messageId: data?.id ?? "sent" };
}
