import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getMemberPermissions } from "@/lib/org-context";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";
import {
  createTelebirrCheckoutSession,
  directPayTelebirr,
  isArifpayConfigured,
  normalizeEthiopiaPhone,
} from "@/lib/payments/arifpay";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  amount: z.number().positive().max(10_000_000),
  phone: z.string().min(9).max(20),
  reference: z.string().min(4).max(80).optional(),
  itemName: z.string().max(200).optional(),
  currency: z.string().length(3).optional(),
  /** Push USSD / Telebirr direct transfer after creating the session (default true). */
  directPay: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  if (!isArifpayConfigured()) {
    return NextResponse.json(
      {
        error:
          "Arifpay is not configured. Set ARIFPAY_API_KEY, ARIFPAY_BENEFICIARY_ACCOUNT, and ARIFPAY_BENEFICIARY_BANK.",
      },
      { status: 503 }
    );
  }

  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`arifpay-telebirr:${ip}`, 40, 15 * 60 * 1000);
  if (!limited.ok) {
    return rateLimitResponse(limited.retryAfterSec);
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { organizationId, amount, phone, itemName, currency, directPay } = parsed.data;

  const permissions = await getMemberPermissions();
  if (!permissions || permissions.activeOrganizationId !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!permissions.canAccessApp("pos")) {
    return NextResponse.json({ error: "POS access required" }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reference =
    parsed.data.reference?.trim() ||
    `TB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  try {
    const session = await createTelebirrCheckoutSession({
      organizationId,
      amount,
      phone: normalizeEthiopiaPhone(phone),
      reference,
      itemName,
      currency,
    });

    let directPayResult: unknown = null;
    let directPayError: string | null = null;
    if (directPay) {
      try {
        directPayResult = await directPayTelebirr(session.sessionId);
      } catch (e) {
        directPayError = e instanceof Error ? e.message : "DirectPay failed";
      }
    }

    return NextResponse.json({
      ok: true,
      reference,
      sessionId: session.sessionId,
      paymentUrl: session.paymentUrl ?? null,
      directPay: directPayResult,
      directPayError,
      message: directPayError
        ? "Checkout session created, but Telebirr push failed — customer may still pay via payment URL if provided."
        : "Telebirr payment requested. Ask the customer to approve on their phone, then complete the sale with this reference.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Arifpay request failed" },
      { status: 502 }
    );
  }
}

/** Public config probe for POS UI (no secrets). */
export async function GET() {
  return NextResponse.json({
    configured: isArifpayConfigured(),
    sandbox: process.env.ARIFPAY_SANDBOX !== "0" && process.env.ARIFPAY_SANDBOX !== "false",
  });
}
