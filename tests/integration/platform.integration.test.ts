import { describe, expect, it } from "vitest";
import {
  hasIntegrationCredentials,
  hasServiceRoleCredentials,
  rpc,
  serviceRpc,
  signIn,
} from "./supabase-client";

const run = hasIntegrationCredentials() ? describe : describe.skip;
const runService = hasServiceRoleCredentials() ? describe : describe.skip;

runService("Platform integration — health probe (service role)", () => {
  it("get_platform_health_probe returns queue metrics", async () => {
    const probe = await serviceRpc<{
      ok?: boolean;
      ledger_queue_pending?: number;
      payment_webhook_queue_pending?: number;
      checked_at?: string;
    }>("get_platform_health_probe");

    expect(probe.ok).not.toBe(false);
    expect(typeof probe.ledger_queue_pending).toBe("number");
    expect(typeof probe.payment_webhook_queue_pending).toBe("number");
    expect(typeof probe.checked_at).toBe("string");
  });
});

run("Platform integration — workspace access", () => {
  it("get_my_workspace returns an active organization", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string; name?: string } }>(
      token,
      "get_my_workspace"
    );
    expect(workspace.organization?.id).toBeTruthy();
    expect(workspace.organization?.name).toBeTruthy();
  });

  it("notification_center_dashboard is accessible for org managers", async () => {
    const token = await signIn();
    const workspace = await rpc<{ organization?: { id?: string } }>(token, "get_my_workspace");
    const orgId = workspace.organization?.id;
    expect(orgId).toBeTruthy();

    const dash = await rpc<{
      sent_today?: number;
      queued?: number;
      failed?: number;
      events_pending?: number;
    }>(token, "notification_center_dashboard", { p_org_id: orgId });
    expect(typeof dash.sent_today).toBe("number");
    expect(typeof dash.queued).toBe("number");
  });
});
