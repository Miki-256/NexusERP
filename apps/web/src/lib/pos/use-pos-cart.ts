"use client";

import { useShallow } from "zustand/react/shallow";
import { useCartStore } from "@/stores/cart-store";

/** Cart state + actions with a single shallow subscription to reduce PosScreen re-renders. */
export function usePosCart() {
  return useCartStore(
    useShallow((s) => ({
      lines: s.lines,
      cartDiscount: s.cartDiscount,
      promoCode: s.promoCode,
      promoDiscount: s.promoDiscount,
      promotionName: s.promotionName,
      promotionId: s.promotionId,
      heldCarts: s.heldCarts,
      addLine: s.addLine,
      updateQuantity: s.updateQuantity,
      removeLine: s.removeLine,
      setCartDiscount: s.setCartDiscount,
      setLineDiscount: s.setLineDiscount,
      applyPromotion: s.applyPromotion,
      clearPromotion: s.clearPromotion,
      clear: s.clear,
      hold: s.hold,
      recall: s.recall,
      initForRegister: s.initForRegister,
    }))
  );
}
