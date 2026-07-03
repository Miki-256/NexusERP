"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import type { AuthLockout, AuthPolicies, SecurityAlertSettings } from "@/lib/admin-types";

const LOCKOUT_LABELS: Record<string, string> = {
  login_email: "Login (email)",
  login_ip: "Login (IP)",
  pos_manager_pin_register: "Manager PIN (register)",
};

function PolicyField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <Input
        id={id}
        type="number"
        min={1}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="max-w-xs"
      />
    </div>
  );
}

export function AuthThrottleClient({
  policies,
  alertSettings,
  lockouts,
  canWrite,
}: {
  policies: AuthPolicies;
  alertSettings: SecurityAlertSettings;
  lockouts: AuthLockout[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [policyForm, setPolicyForm] = useState(policies);
  const [alerts, setAlerts] = useState(alertSettings);
  const [showAllLockouts, setShowAllLockouts] = useState(false);
  const [busy, setBusy] = useState<"policies" | "alerts" | string | null>(null);

  async function savePolicies() {
    setBusy("policies");
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_update_auth_policies", {
      p_payload: policyForm,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Auth policies saved" });
    router.refresh();
  }

  async function saveAlerts() {
    setBusy("alerts");
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_set_auth_security_settings", {
      p_settings: alerts,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Alert settings saved" });
    router.refresh();
  }

  async function unlockLockout(lockoutType: string, identifier: string) {
    setBusy(`${lockoutType}:${identifier}`);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_unlock_auth_lockout", {
      p_lockout_type: lockoutType,
      p_identifier: identifier,
    });
    setBusy(null);
    if (error) {
      toast({ title: "Unlock failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Lockout cleared" });
    router.refresh();
  }

  const displayedLockouts = showAllLockouts
    ? lockouts
    : lockouts.filter((l) => l.is_active);

  return (
    <div className="space-y-6">
      <FormCard
        title="Login lockout policy"
        description="Thresholds for email and IP-based login throttling. Changes apply immediately to new attempts."
      >
        {!canWrite && (
          <p className="mb-4 text-sm text-muted-foreground">
            Read-only — requires App Support or Super Admin.
          </p>
        )}
        <div className="grid gap-6 sm:grid-cols-2">
          <PolicyField
            id="max_login_failures_email"
            label="Max failures per email"
            hint="Within the failure window before lockout."
            value={policyForm.max_login_failures_email}
            disabled={!canWrite}
            onChange={(v) => setPolicyForm({ ...policyForm, max_login_failures_email: v })}
          />
          <PolicyField
            id="max_login_failures_ip"
            label="Max failures per IP"
            value={policyForm.max_login_failures_ip}
            disabled={!canWrite}
            onChange={(v) => setPolicyForm({ ...policyForm, max_login_failures_ip: v })}
          />
          <PolicyField
            id="login_failure_window_minutes"
            label="Failure window (minutes)"
            value={policyForm.login_failure_window_minutes}
            disabled={!canWrite}
            onChange={(v) => setPolicyForm({ ...policyForm, login_failure_window_minutes: v })}
          />
          <PolicyField
            id="login_lockout_minutes"
            label="Login lockout duration (minutes)"
            value={policyForm.login_lockout_minutes}
            disabled={!canWrite}
            onChange={(v) => setPolicyForm({ ...policyForm, login_lockout_minutes: v })}
          />
        </div>
        {canWrite && (
          <Button className="mt-4" disabled={busy === "policies"} onClick={savePolicies}>
            {busy === "policies" ? "Saving…" : "Save login policy"}
          </Button>
        )}
      </FormCard>

      <FormCard
        title="POS PIN policy"
        description="Staff PIN lockouts use pos_staff records. Manager override PIN lockouts are per register."
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <PolicyField
            id="max_pin_failures"
            label="Max staff PIN failures"
            value={policyForm.max_pin_failures}
            disabled={!canWrite}
            onChange={(v) => setPolicyForm({ ...policyForm, max_pin_failures: v })}
          />
          <PolicyField
            id="pin_lockout_minutes"
            label="Staff PIN lockout (minutes)"
            value={policyForm.pin_lockout_minutes}
            disabled={!canWrite}
            onChange={(v) => setPolicyForm({ ...policyForm, pin_lockout_minutes: v })}
          />
          <PolicyField
            id="max_manager_pin_failures_register"
            label="Max manager PIN failures (per register)"
            value={policyForm.max_manager_pin_failures_register}
            disabled={!canWrite}
            onChange={(v) =>
              setPolicyForm({ ...policyForm, max_manager_pin_failures_register: v })
            }
          />
        </div>
        {canWrite && (
          <Button className="mt-4" disabled={busy === "policies"} onClick={savePolicies}>
            {busy === "policies" ? "Saving…" : "Save PIN policy"}
          </Button>
        )}
        {policies.updated_at && (
          <p className="mt-3 text-xs text-muted-foreground">
            Last updated {new Date(policies.updated_at).toLocaleString()}
          </p>
        )}
      </FormCard>

      <FormCard
        title="Lockout alerts"
        description="Webhook notifications when login or manager PIN lockouts trigger. Processed by the daily cron or POST /api/webhooks/process-security-alerts."
      >
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alerts.enabled}
              disabled={!canWrite}
              onChange={(e) => setAlerts({ ...alerts, enabled: e.target.checked })}
            />
            Enable lockout alerts
          </label>
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">Webhook URL</Label>
            <Input
              id="webhookUrl"
              type="url"
              placeholder="https://hooks.slack.com/services/…"
              value={alerts.webhook_url}
              disabled={!canWrite}
              onChange={(e) => setAlerts({ ...alerts, webhook_url: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alerts.notify_slack}
              disabled={!canWrite}
              onChange={(e) => setAlerts({ ...alerts, notify_slack: e.target.checked })}
            />
            Slack-compatible payload ({`{ "text": "…" }`})
          </label>
        </div>
        {canWrite && (
          <Button className="mt-4" disabled={busy === "alerts"} onClick={saveAlerts}>
            {busy === "alerts" ? "Saving…" : "Save alert settings"}
          </Button>
        )}
      </FormCard>

      <FormCard
        title="Active lockouts"
        description="Clear a lockout to allow immediate retry. Identifiers are normalized (emails lowercased)."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            variant={showAllLockouts ? "outline" : "default"}
            size="sm"
            onClick={() => setShowAllLockouts(false)}
          >
            Active only
          </Button>
          <Button
            variant={showAllLockouts ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAllLockouts(true)}
          >
            Show recent (all)
          </Button>
        </div>
        {displayedLockouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lockouts to show.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {displayedLockouts.map((row) => (
              <li
                key={`${row.lockout_type}:${row.identifier}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {LOCKOUT_LABELS[row.lockout_type] ?? row.lockout_type}
                  </p>
                  <p className="truncate text-muted-foreground">{row.identifier}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.failed_attempts} failures · last{" "}
                    {new Date(row.last_attempt_at).toLocaleString()}
                    {row.locked_until && (
                      <> · locked until {new Date(row.locked_until).toLocaleString()}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {row.is_active ? (
                    <StatusBadge status="suspended" />
                  ) : (
                    <StatusBadge status="active" />
                  )}
                  {canWrite && row.is_active && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `${row.lockout_type}:${row.identifier}`}
                      onClick={() => unlockLockout(row.lockout_type, row.identifier)}
                    >
                      Unlock
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </FormCard>
    </div>
  );
}
