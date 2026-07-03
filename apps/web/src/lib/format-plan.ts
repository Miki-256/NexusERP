/** Display label for subscription plans (id `free` is branded Basic). */
export function formatPlanName(planId: string, planName?: string | null): string {
  if (planId === "free") return "Basic";
  if (planName?.trim()) return planName;
  return planId;
}
