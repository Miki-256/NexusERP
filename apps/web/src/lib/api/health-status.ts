export type HealthProbePayload = {
  ok?: boolean;
  ledger_queue_pending?: number;
  payment_webhook_queue_pending?: number;
  checked_at?: string;
};

export function isHealthDegraded(ledgerPending: number, webhookPending: number): boolean {
  return ledgerPending > 100 || webhookPending > 50;
}

export function healthHttpStatus(ledgerPending: number, webhookPending: number): 200 | 503 {
  return isHealthDegraded(ledgerPending, webhookPending) ? 503 : 200;
}

export function buildHealthResponse(probe: HealthProbePayload) {
  const ledgerPending = probe.ledger_queue_pending ?? 0;
  const webhookPending = probe.payment_webhook_queue_pending ?? 0;
  const degraded = isHealthDegraded(ledgerPending, webhookPending);

  return {
    body: {
      ok: probe.ok ?? true,
      status: degraded ? ("degraded" as const) : ("healthy" as const),
      ledger_queue_pending: ledgerPending,
      payment_webhook_queue_pending: webhookPending,
      checked_at: probe.checked_at ?? new Date().toISOString(),
    },
    status: healthHttpStatus(ledgerPending, webhookPending),
  };
}

export function buildLivenessResponse() {
  return {
    body: {
      ok: true,
      status: "healthy" as const,
      mode: "liveness" as const,
      checked_at: new Date().toISOString(),
    },
    status: 200 as const,
  };
}
