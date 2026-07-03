export type PlanLimitParseResult =
  | { isPlanLimit: true; title: string; description: string; billingHref: string }
  | { isPlanLimit: false; description: string };

/** Map Postgres plan-limit errors to tenant-friendly copy. */
export function parsePlanLimitError(error: { message: string }): PlanLimitParseResult {
  const msg = error.message ?? "";
  if (/plan limit reached/i.test(msg)) {
    return {
      isPlanLimit: true,
      title: "Plan limit reached",
      description: msg,
      billingHref: "/settings/billing",
    };
  }
  return { isPlanLimit: false, description: msg || "Something went wrong." };
}

export function planLimitToastDescription(parsed: PlanLimitParseResult): string {
  if (parsed.isPlanLimit) {
    return `${parsed.description} See Settings → Billing for usage and upgrade options.`;
  }
  return parsed.description;
}
