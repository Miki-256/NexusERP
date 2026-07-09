import { createClient } from "@/lib/supabase/client";

export type GiftCardLookup = {
  valid: boolean;
  message?: string;
  id?: string;
  code?: string;
  balance?: number;
  expiresAt?: string | null;
};

export async function lookupGiftCard(
  organizationId: string,
  code: string
): Promise<GiftCardLookup> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("lookup_gift_card", {
    p_org_id: organizationId,
    p_code: code.trim(),
  });

  if (error) {
    return { valid: false, message: error.message };
  }

  const row = data as {
    valid?: boolean;
    message?: string;
    id?: string;
    code?: string;
    balance?: number;
    expires_at?: string | null;
  };

  return {
    valid: Boolean(row?.valid),
    message: row?.message,
    id: row?.id,
    code: row?.code,
    balance: row?.balance != null ? Number(row.balance) : undefined,
    expiresAt: row?.expires_at ?? null,
  };
}
