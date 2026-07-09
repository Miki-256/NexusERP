/** Currency value of redeeming loyalty points at POS. */
export function loyaltyValueFromPoints(points: number, spendPerPoint: number): number {
  const rate = Math.max(spendPerPoint, 0.01);
  return Math.round(Math.max(points, 0) * rate * 100) / 100;
}

/** Points required for a currency redemption amount. */
export function loyaltyPointsFromAmount(amount: number, spendPerPoint: number): number {
  const rate = Math.max(spendPerPoint, 0.01);
  return Math.max(Math.ceil(amount / rate), 0);
}

/** Estimated points earned on merchandise subtotal. */
export function loyaltyPointsEarned(merchSubtotal: number, pointsPerCurrency: number): number {
  return Math.max(Math.floor(Math.max(merchSubtotal, 0) * Math.max(pointsPerCurrency, 0)), 0);
}
