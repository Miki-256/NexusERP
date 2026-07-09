import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimedDelivery } from "../types";

export type WhatsAppDeliveryResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

type WhatsAppChannelConfig = {
  is_enabled?: boolean;
  phone_number_id?: string | null;
  access_token?: string | null;
  template_language?: string | null;
};

type TemplateMeta = {
  whatsapp_template_name?: string;
  whatsapp_language?: string;
  whatsapp_param_keys?: string[];
};

type DeliveryAttachment = {
  url?: string;
  filename?: string;
  mime_type?: string;
  type?: string;
};

function whatsappEnabled(): boolean {
  const flag = process.env.NOTIFICATION_WHATSAPP_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

function graphApiVersion(): string {
  return process.env.WHATSAPP_API_VERSION?.trim() || "v21.0";
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function buildTemplateParameters(body: string, paramKeys: string[] | undefined): { type: "text"; text: string }[] {
  const parts = body.split("|").map((p) => p.trim());
  if (paramKeys?.length) {
    return paramKeys.map((_, i) => ({ type: "text" as const, text: parts[i] ?? "" }));
  }
  return parts.filter(Boolean).map((text) => ({ type: "text" as const, text }));
}

export async function deliverWhatsApp(
  admin: SupabaseClient,
  delivery: ClaimedDelivery
): Promise<WhatsAppDeliveryResult> {
  if (!whatsappEnabled()) {
    return { ok: false, error: "WhatsApp channel disabled (NOTIFICATION_WHATSAPP_ENABLED)" };
  }

  const { data: configRaw, error: configError } = await admin.rpc(
    "get_notification_whatsapp_config_internal",
    { p_org_id: delivery.organization_id }
  );
  if (configError) {
    return { ok: false, error: configError.message };
  }

  const config = (configRaw ?? {}) as WhatsAppChannelConfig;
  if (!config.is_enabled) {
    return { ok: false, error: "WhatsApp channel is disabled for this organization" };
  }

  const phoneNumberId = config.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = config.access_token || process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return {
      ok: false,
      error: "Missing phone_number_id or access_token (org settings or WHATSAPP_* env)",
    };
  }

  const to = normalizePhone(delivery.recipient_ref);
  if (!to) {
    return { ok: false, error: "Invalid WhatsApp recipient phone" };
  }

  const { data: deliveryRow } = await admin
    .from("notification_deliveries")
    .select("attachments, notification_templates(provider_meta, subject_template)")
    .eq("id", delivery.id)
    .maybeSingle();

  const templateRow = deliveryRow as {
    attachments?: DeliveryAttachment[];
    notification_templates?: { provider_meta?: TemplateMeta; subject_template?: string | null } | null;
  } | null;

  const providerMeta = templateRow?.notification_templates?.provider_meta ?? {};
  const templateName =
    providerMeta.whatsapp_template_name ||
    delivery.subject?.trim() ||
    templateRow?.notification_templates?.subject_template?.trim() ||
    "";
  const language = providerMeta.whatsapp_language || config.template_language || "en";

  const attachments = Array.isArray(templateRow?.attachments) ? templateRow.attachments : [];
  const document = attachments.find(
    (a) => a?.url && (a.type === "document" || a.mime_type?.includes("pdf") || a.filename?.endsWith(".pdf"))
  );

  const baseUrl = `https://graph.facebook.com/${graphApiVersion()}/${phoneNumberId}/messages`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  if (document?.url) {
    const docResponse = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          link: document.url,
          filename: document.filename || "invoice.pdf",
        },
      }),
    });
    const docPayload = (await docResponse.json()) as {
      messages?: { id?: string }[];
      error?: { message?: string };
    };
    if (!docResponse.ok) {
      return {
        ok: false,
        error: docPayload.error?.message ?? `WhatsApp document API error (${docResponse.status})`,
      };
    }
  }

  if (!templateName) {
    return { ok: false, error: "WhatsApp template name missing on delivery" };
  }

  const parameters = buildTemplateParameters(delivery.body, providerMeta.whatsapp_param_keys);

  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
        components: parameters.length
          ? [{ type: "body", parameters }]
          : undefined,
      },
    }),
  });

  const payload = (await response.json()) as {
    messages?: { id?: string }[];
    error?: { message?: string };
  };

  if (!response.ok) {
    return {
      ok: false,
      error: payload.error?.message ?? `WhatsApp API error (${response.status})`,
    };
  }

  const messageId = payload.messages?.[0]?.id;
  if (!messageId) {
    return { ok: false, error: "WhatsApp API returned no message id" };
  }

  return { ok: true, messageId };
}

/** Verify Meta webhook signature (x-hub-signature-256). */
export function verifyWhatsAppWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return signatureHeader.slice(7) === expected;
}
