import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedDelivery } from "../types";
import { resolveEmailSender, type EmailChannelConfig } from "./email-sender";

export type EmailDeliveryResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

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
  const sender = resolveEmailSender(config, {
    defaultFromEmail: process.env.NOTIFICATION_FROM_EMAIL,
    defaultFromName: process.env.NOTIFICATION_FROM_NAME,
  });
  if (!sender.ok) {
    return { ok: false, error: sender.error };
  }

  const resend = new Resend(apiKey);
  const subject = delivery.subject ?? "(no subject)";
  const { data, error } =
    delivery.body_format === "html"
      ? await resend.emails.send({
          from: sender.from,
          to: delivery.recipient_ref,
          subject,
          html: delivery.body,
          replyTo: sender.replyTo,
        })
      : await resend.emails.send({
          from: sender.from,
          to: delivery.recipient_ref,
          subject,
          text: delivery.body,
          replyTo: sender.replyTo,
        });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, messageId: data?.id ?? "sent" };
}
