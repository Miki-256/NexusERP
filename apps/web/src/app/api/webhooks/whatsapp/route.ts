import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { verifyWhatsAppWebhookSignature } from "@/lib/notifications/channels/whatsapp";

type WhatsAppStatusUpdate = {
  id?: string;
  status?: string;
  errors?: { title?: string; message?: string }[];
};

type WhatsAppWebhookBody = {
  object?: string;
  entry?: {
    changes?: {
      value?: {
        statuses?: WhatsAppStatusUpdate[];
      };
    }[];
  }[];
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Meta webhook verification (subscribe). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/** Inbound delivery status updates from Meta Cloud API. */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWhatsAppWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody) as WhatsAppWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const results: Record<string, unknown>[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id) continue;
        const errorText =
          status.errors?.map((e) => e.message || e.title).filter(Boolean).join("; ") || null;

        const { data, error } = await admin.rpc("apply_whatsapp_delivery_status", {
          p_provider_message_id: status.id,
          p_status: status.status ?? "sent",
          p_error: errorText,
        });

        results.push({
          message_id: status.id,
          status: status.status,
          updated: !error,
          result: error ? { error: error.message } : data,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
