"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { CommunicationsSubNav } from "../communications-sub-nav";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import type { NotificationRuleRow } from "@/lib/notifications/types";

export function RulesClient({
  orgId,
  rules: initial,
}: {
  orgId: string;
  rules: NotificationRuleRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rules, setRules] = useState(initial);
  const [busy, setBusy] = useState("");

  async function toggleActive(rule: NotificationRuleRow) {
    setBusy(rule.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_notification_rule", {
      p_org_id: orgId,
      p_rule_id: rule.id,
      p_name: rule.name,
      p_event_type: rule.event_type,
      p_conditions: rule.conditions,
      p_channels: rule.channels,
      p_recipient_spec: rule.recipient_spec,
      p_template_codes: rule.template_codes,
      p_is_active: !rule.is_active,
      p_sort_order: rule.sort_order,
    });
    setBusy("");
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    const { data } = await supabase.rpc("list_notification_rules", { p_org_id: orgId });
    setRules(parseRpcJsonArray<NotificationRuleRow>(data));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Notification rules"
        description="Control who gets notified, on which channel, when events fire. POS sales and low-stock scans use these rules."
      />
      <CommunicationsSubNav active="/communications/rules" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rules for this organization yet. Open this page again as an owner or manager to seed
              defaults, or check Communications → Channels to enable Telegram first.
            </p>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-col gap-2 rounded-lg border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{rule.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{rule.event_type}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {rule.channels.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                    {rule.conditions.length > 0 && (
                      <Badge variant="outline">{rule.conditions.length} condition(s)</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Templates: {Object.entries(rule.template_codes).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={rule.is_active ? "default" : "outline"}
                  disabled={busy === rule.id}
                  onClick={() => toggleActive(rule)}
                >
                  {rule.is_active ? "Active" : "Inactive"}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How rules work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• <strong>POS sale — manager in-app</strong> — every completed sale notifies owners & managers in the bell inbox.</p>
          <p>• <strong>POS sale — Telegram group</strong> — sends each sale to your Telegram group (enable under Channels + set chat ID).</p>
          <p>• <strong>High-value POS sale — owner email</strong> — disabled by default; enable after configuring email under Channels. Fires when total &gt; 10,000.</p>
          <p>• <strong>Low stock — manager in-app</strong> — cron scans inventory daily and enqueues low-stock events.</p>
          <p>• <strong>Low stock / Daily sales — Telegram</strong> — optional rules; enable after Telegram is configured under Channels.</p>
          <p>Conditions use fields like <code className="rounded bg-muted px-1">payload.total</code> with operators eq, gt, gte, lt, lte, in.</p>
        </CardContent>
      </Card>
    </div>
  );
}
