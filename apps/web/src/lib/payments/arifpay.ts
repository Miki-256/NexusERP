/**
 * Arifpay gateway client (Telebirr via TELEBIRR_USSD + DirectPay).
 * Official SDK paths: https://gateway.arifpay.net/v0 + header x-arifpay-key
 * Docs: https://developer.arifpay.net/
 */

export type ArifpayCheckoutSession = {
  sessionId: string;
  paymentUrl?: string;
  uuid?: string;
  totalAmount?: number;
  [key: string]: unknown;
};

export type CreateTelebirrCheckoutInput = {
  organizationId: string;
  amount: number;
  phone: string;
  /** Stable payment reference stored on Nexus payments.reference */
  reference: string;
  itemName?: string;
  currency?: string;
};

function env(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

export function isArifpayConfigured(): boolean {
  return Boolean(
    env("ARIFPAY_API_KEY") &&
      env("ARIFPAY_BENEFICIARY_ACCOUNT") &&
      env("ARIFPAY_BENEFICIARY_BANK")
  );
}

export function isArifpayUiEnabled(): boolean {
  if (env("NEXT_PUBLIC_ARIFPAY_ENABLED") === "1" || env("NEXT_PUBLIC_ARIFPAY_ENABLED") === "true") {
    return true;
  }
  // Server-side: show when fully configured (POS still needs the public flag for client UI).
  return isArifpayConfigured();
}

function gatewayBase(): string {
  return (env("ARIFPAY_BASE_URL") ?? "https://gateway.arifpay.net/v0").replace(/\/$/, "");
}

function isArifpaySandbox(): boolean {
  const v = env("ARIFPAY_SANDBOX");
  if (v === "0" || v === "false") return false;
  return v !== "false"; // default sandbox until explicitly disabled
}

function appUrl(): string {
  return (env("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3003").replace(/\/$/, "");
}

function notifyUrl(organizationId: string): string {
  return `${appUrl()}/api/webhooks/arifpay/${organizationId}`;
}

async function arifpayFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const apiKey = env("ARIFPAY_API_KEY");
  if (!apiKey) throw new Error("ARIFPAY_API_KEY is not configured");

  const res = await fetch(`${gatewayBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-arifpay-key": apiKey,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(120_000),
  });

  const json = (await res.json().catch(() => ({}))) as {
    msg?: string;
    message?: string;
    data?: T;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(json.msg ?? json.message ?? json.error ?? `Arifpay HTTP ${res.status}`);
  }

  return (json.data ?? json) as T;
}

function expireInHours(hours = 1): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

/** Normalize Ethiopian phone to digits starting with 251 when possible. */
export function normalizeEthiopiaPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("251") && digits.length >= 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `251${digits.slice(1)}`;
  if (digits.length === 9) return `251${digits}`;
  return digits;
}

export async function createTelebirrCheckoutSession(
  input: CreateTelebirrCheckoutInput
): Promise<ArifpayCheckoutSession> {
  if (!isArifpayConfigured()) {
    throw new Error(
      "Arifpay is not configured. Set ARIFPAY_API_KEY, ARIFPAY_BENEFICIARY_ACCOUNT, ARIFPAY_BENEFICIARY_BANK."
    );
  }

  const phone = normalizeEthiopiaPhone(input.phone);
  if (phone.length < 9) throw new Error("A valid customer phone is required for Telebirr");

  const amount = Math.round(input.amount * 100) / 100;
  if (!(amount > 0)) throw new Error("Amount must be positive");

  const prefix = isArifpaySandbox() ? "/sandbox/" : "/";
  const body = {
    cancelUrl: `${appUrl()}/pos?arifpay=cancel`,
    errorUrl: `${appUrl()}/pos?arifpay=error`,
    successUrl: `${appUrl()}/pos?arifpay=success`,
    notifyUrl: notifyUrl(input.organizationId),
    expireDate: expireInHours(2),
    nonce: input.reference,
    phone,
    email: env("ARIFPAY_MERCHANT_EMAIL") ?? "payments@nexus.local",
    paymentMethods: ["TELEBIRR_USSD"],
    items: [
      {
        name: input.itemName ?? "POS sale",
        quantity: 1,
        price: amount,
        description: `NexusERP ${input.reference}`,
      },
    ],
    beneficiaries: [
      {
        accountNumber: env("ARIFPAY_BENEFICIARY_ACCOUNT"),
        bank: env("ARIFPAY_BENEFICIARY_BANK"),
        amount,
      },
    ],
    lang: "EN",
    currency: input.currency ?? "ETB",
  };

  return arifpayFetch<ArifpayCheckoutSession>(`${prefix}checkout/session`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Push Telebirr USSD / direct transfer for an existing checkout session. */
export async function directPayTelebirr(sessionId: string): Promise<unknown> {
  return arifpayFetch("/checkout/telebirr/direct/transfer", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export async function fetchCheckoutSession(sessionId: string): Promise<ArifpayCheckoutSession> {
  const prefix = isArifpaySandbox() ? "/sandbox/" : "/";
  return arifpayFetch<ArifpayCheckoutSession>(`${prefix}checkout/session/${sessionId}`);
}

export type ArifpayNotifyParse = {
  reference: string | null;
  sessionId: string | null;
  externalId: string | null;
  amount: number | null;
  success: boolean;
  rawStatus: string | null;
};

/**
 * Auth for Arifpay → Nexus notify webhooks.
 * Prefer `ARIFPAY_WEBHOOK_SECRET` (header `x-arifpay-webhook-secret` or `x-webhook-secret`).
 * Without a secret, only non-production sandbox is allowed.
 */
export function verifyArifpayNotifyAuth(request: Request): boolean {
  const secret = env("ARIFPAY_WEBHOOK_SECRET");
  if (secret) {
    const header =
      request.headers.get("x-arifpay-webhook-secret")?.trim() ||
      request.headers.get("x-webhook-secret")?.trim() ||
      "";
    return header.length > 0 && header === secret;
  }

  if (process.env.NODE_ENV === "production" && !isArifpaySandbox()) {
    return false;
  }

  return isArifpayConfigured();
}

/** Best-effort parse of Arifpay notify / callback payloads (shapes vary by product version). */
export function parseArifpayNotify(body: unknown): ArifpayNotifyParse {
  const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const nested =
    obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : {};

  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (obj[k] != null && obj[k] !== "") return obj[k];
      if (nested[k] != null && nested[k] !== "") return nested[k];
    }
    return null;
  };

  const reference = String(pick("nonce", "reference", "merch_order_id", "merchOrderId") ?? "") || null;
  const sessionId = String(pick("sessionId", "session_id", "uuid") ?? "") || null;
  const externalId =
    String(pick("transactionId", "transaction_id", "txnId", "id", "paymentId") ?? "") ||
    sessionId;

  const amountRaw = pick("totalAmount", "amount", "paidAmount");
  const amount =
    typeof amountRaw === "number"
      ? amountRaw
      : typeof amountRaw === "string" && amountRaw.trim()
        ? Number(amountRaw)
        : null;

  const status = String(
    pick("paymentStatus", "status", "transactionStatus", "state") ?? ""
  ).toLowerCase();
  const success =
    status === "" ||
    status === "success" ||
    status === "successful" ||
    status === "completed" ||
    status === "paid" ||
    obj.success === true ||
    nested.success === true;

  return {
    reference,
    sessionId,
    externalId,
    amount: Number.isFinite(amount as number) ? (amount as number) : null,
    success,
    rawStatus: status || null,
  };
}
