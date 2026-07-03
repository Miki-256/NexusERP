import { createClient } from "@/lib/supabase/client";
import type { CartLine } from "@/stores/cart-store";

export type AppliedPromotion = {
  promotionId: string;
  name: string;
  code: string;
  discountAmount: number;
};

export type PromotionValidation =
  | { ok: true; promotion: AppliedPromotion }
  | { ok: false; message: string };

export function merchSubtotal(lines: CartLine[]): number {
  return lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity - line.discountAmount,
    0
  );
}

export async function validatePromotionCode(
  organizationId: string,
  code: string,
  lines: CartLine[],
  sessionToken?: string | null
): Promise<PromotionValidation> {
  const trimmed = code.trim();
  if (!trimmed) {
    return { ok: false, message: "Enter a promotion code" };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("validate_promotion_code", {
    p_organization_id: organizationId,
    p_code: trimmed,
    p_merch_subtotal: merchSubtotal(lines),
    p_session_token: sessionToken ?? null,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  const result = data as {
    valid?: boolean;
    message?: string;
    promotion_id?: string;
    name?: string;
    code?: string;
    discount_amount?: number;
  };

  if (!result.valid) {
    return { ok: false, message: result.message ?? "Invalid promotion code" };
  }

  return {
    ok: true,
    promotion: {
      promotionId: result.promotion_id!,
      name: result.name ?? trimmed,
      code: result.code ?? trimmed,
      discountAmount: Number(result.discount_amount) || 0,
    },
  };
}
