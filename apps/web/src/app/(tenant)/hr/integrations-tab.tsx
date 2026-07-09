"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { TabBar } from "@/components/layout/tab-bar";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { downloadCsv } from "@/lib/csv-export";
import { runHrMutation } from "@/lib/hr/mutations";
import type {
  HrCsvExportResult,
  HrPayrollGlMappingRow,
  HrWebhookDeliveryRow,
  HrWebhookEndpointRow,
  PayComponentRow,
} from "@/lib/hr/types";
import { Download, Link2, Plus, Save, Trash2, Webhook } from "lucide-react";

type IntTab = "exports" | "gl" | "webhooks";

const WEBHOOK_EVENTS = [
  "hr.payroll_posted",
  "hr.offboarding_started",
  "hr.leave_requested",
  "hr.leave_approved",
  "hr.probation_completed",
  "hr.contract_expiring",
] as const;

function monthStartIso() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseExportResult(data: unknown): HrCsvExportResult | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.content !== "string" || typeof row.filename !== "string") return null;
  return {
    content: row.content,
    filename: row.filename,
    row_count: typeof row.row_count === "number" ? row.row_count : 0,
  };
}

export function IntegrationsTab({
  organizationId,
  glMappings,
  payComponents,
  webhookEndpoints,
  webhookDeliveries,
  webhookDeliveryTotal,
}: {
  organizationId: string;
  glMappings: HrPayrollGlMappingRow[];
  payComponents: PayComponentRow[];
  webhookEndpoints: HrWebhookEndpointRow[];
  webhookDeliveries: HrWebhookDeliveryRow[];
  webhookDeliveryTotal: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<IntTab>("exports");
  const [busy, setBusy] = useState(false);
  const [exportFrom, setExportFrom] = useState(monthStartIso());
  const [exportTo, setExportTo] = useState(todayIso());
  const [glEdits, setGlEdits] = useState<Record<string, string>>({});
  const [componentGlEdits, setComponentGlEdits] = useState<Record<string, string>>({});
  const [newEndpoint, setNewEndpoint] = useState({
    name: "",
    url: "",
    secret: "",
    events: [] as string[],
  });

  async function runExport(
    rpc:
      | "export_hr_employees_csv"
      | "export_hr_leave_csv"
      | "export_hr_payroll_csv"
      | "export_hr_attendance_csv",
    label: string
  ) {
    setBusy(true);
    const supabase = createClient();
    const args =
      rpc === "export_hr_employees_csv"
        ? { p_org_id: organizationId }
        : {
            p_org_id: organizationId,
            p_from: exportFrom,
            p_to: exportTo,
          };
    const { data, error } = await supabase.rpc(rpc, args);
    setBusy(false);
    if (error) {
      toast({ title: `${label} export failed`, description: error.message, variant: "destructive" });
      return;
    }
    const result = parseExportResult(data);
    if (!result) {
      toast({ title: "Export failed", description: "Unexpected response", variant: "destructive" });
      return;
    }
    downloadCsv(result.filename, result.content);
    toast({
      title: `${label} exported`,
      description: `${result.row_count} row${result.row_count === 1 ? "" : "s"} downloaded.`,
    });
  }

  async function saveGlMapping(mappingKey: string) {
    const code = glEdits[mappingKey];
    if (!code?.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(router, toast, async () => {
      const { error } = await supabase.rpc("upsert_hr_payroll_gl_mapping", {
        p_org_id: organizationId,
        p_mapping_key: mappingKey,
        p_gl_account_code: code.trim(),
      });
      return { error };
    }, { successTitle: "GL mapping saved" });
    setBusy(false);
    if (ok) {
      setGlEdits((prev) => {
        const next = { ...prev };
        delete next[mappingKey];
        return next;
      });
      router.refresh();
    }
  }

  async function saveComponentGl(component: PayComponentRow) {
    const code = componentGlEdits[component.id] ?? component.gl_account_code ?? "";
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(router, toast, async () => {
      const { error } = await supabase.rpc("upsert_pay_component", {
        p_org_id: organizationId,
        p_code: component.code,
        p_name: component.name,
        p_component_type: component.component_type,
        p_calc_type: component.calc_type,
        p_default_amount: component.default_amount,
        p_default_rate: component.default_rate,
        p_id: component.id,
        p_gl_account_code: code.trim() || null,
      });
      return { error };
    }, { successTitle: "Component GL saved" });
    setBusy(false);
    if (ok) {
      setComponentGlEdits((prev) => {
        const next = { ...prev };
        delete next[component.id];
        return next;
      });
      router.refresh();
    }
  }

  async function addEndpoint(e: React.FormEvent) {
    e.preventDefault();
    if (!newEndpoint.name.trim() || !newEndpoint.url.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(router, toast, async () => {
      const { error } = await supabase.rpc("upsert_hr_webhook_endpoint", {
        p_org_id: organizationId,
        p_name: newEndpoint.name.trim(),
        p_url: newEndpoint.url.trim(),
        p_events: newEndpoint.events,
        p_secret: newEndpoint.secret.trim() || null,
        p_is_active: true,
      });
      return { error };
    }, { successTitle: "Webhook endpoint added" });
    setBusy(false);
    if (ok) {
      setNewEndpoint({ name: "", url: "", secret: "", events: [] });
      router.refresh();
    }
  }

  async function toggleEndpoint(ep: HrWebhookEndpointRow) {
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(router, toast, async () => {
      const { error } = await supabase.rpc("upsert_hr_webhook_endpoint", {
        p_org_id: organizationId,
        p_name: ep.name,
        p_url: ep.url,
        p_events: ep.events,
        p_is_active: !ep.is_active,
        p_id: ep.id,
      });
      return { error };
    }, { successTitle: ep.is_active ? "Endpoint disabled" : "Endpoint enabled" });
    setBusy(false);
    if (ok) router.refresh();
  }

  async function deleteEndpoint(id: string) {
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(router, toast, async () => {
      const { error } = await supabase.rpc("delete_hr_webhook_endpoint", { p_id: id });
      return { error };
    }, { successTitle: "Endpoint deleted" });
    setBusy(false);
    if (ok) router.refresh();
  }

  function toggleNewEvent(event: string) {
    setNewEndpoint((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  }

  return (
    <div className="space-y-6">
      <TabBar
        tabs={[
          { key: "exports" as const, label: "Exports" },
          { key: "gl" as const, label: "GL Mapping" },
          { key: "webhooks" as const, label: "Webhooks" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "exports" && (
        <div className="space-y-4">
          <FormCard title="Date range" description="Used for leave, payroll, and attendance exports.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="export-from">From</Label>
                <DatePicker id="export-from" value={exportFrom} onChange={setExportFrom} />
              </div>
              <div>
                <Label htmlFor="export-to">To</Label>
                <DatePicker id="export-to" value={exportTo} onChange={setExportTo} />
              </div>
            </div>
          </FormCard>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["export_hr_employees_csv", "Employees"],
                ["export_hr_leave_csv", "Leave requests"],
                ["export_hr_payroll_csv", "Payroll runs"],
                ["export_hr_attendance_csv", "Attendance"],
              ] as const
            ).map(([rpc, label]) => (
              <Button
                key={rpc}
                variant="outline"
                className="justify-start gap-2"
                disabled={busy}
                onClick={() => void runExport(rpc, label)}
              >
                <Download className="h-4 w-4" />
                Export {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {tab === "gl" && (
        <div className="space-y-6">
          <FormCard
            title="Summary GL accounts"
            description="Fallback accounts when pay components do not have component-level GL codes."
          >
            <DataTable>
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead>Mapping</DataTableHead>
                  <DataTableHead>Description</DataTableHead>
                  <DataTableHead>GL code</DataTableHead>
                  <DataTableHead className="w-24">&nbsp;</DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {glMappings.length === 0 ? (
                  <DataTableEmpty colSpan={4} message="No mappings" />
                ) : (
                  glMappings.map((m) => (
                    <DataTableRow key={m.id}>
                      <DataTableCell className="font-mono text-sm">{m.mapping_key}</DataTableCell>
                      <DataTableCell className="text-muted-foreground text-sm">
                        {m.description ?? "—"}
                      </DataTableCell>
                      <DataTableCell>
                        <Input
                          className="max-w-[120px] font-mono"
                          value={glEdits[m.mapping_key] ?? m.gl_account_code}
                          onChange={(e) =>
                            setGlEdits((prev) => ({ ...prev, [m.mapping_key]: e.target.value }))
                          }
                        />
                      </DataTableCell>
                      <DataTableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void saveGlMapping(m.mapping_key)}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </DataTable>
          </FormCard>

          <FormCard
            title="Pay component GL codes"
            description="When set, posted payroll uses component-level journal lines instead of summary accounts."
          >
            <DataTable>
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead>Code</DataTableHead>
                  <DataTableHead>Name</DataTableHead>
                  <DataTableHead>Type</DataTableHead>
                  <DataTableHead>GL code</DataTableHead>
                  <DataTableHead className="w-24">&nbsp;</DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {payComponents.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No pay components" />
                ) : (
                  payComponents.map((c) => (
                    <DataTableRow key={c.id}>
                      <DataTableCell className="font-mono text-sm">{c.code}</DataTableCell>
                      <DataTableCell>{c.name}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={c.component_type} />
                      </DataTableCell>
                      <DataTableCell>
                        <Input
                          className="max-w-[120px] font-mono"
                          placeholder="e.g. 6400"
                          value={componentGlEdits[c.id] ?? c.gl_account_code ?? ""}
                          onChange={(e) =>
                            setComponentGlEdits((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                        />
                      </DataTableCell>
                      <DataTableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void saveComponentGl(c)}
                        >
                          <Save className="h-4 w-4" />
                        </Button>
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </DataTable>
          </FormCard>
        </div>
      )}

      {tab === "webhooks" && (
        <div className="space-y-6">
          <FormCard
            title="Add webhook endpoint"
            description="Outbound POST hooks for HR events. Leave events empty to receive all event types."
          >
            <form onSubmit={addEndpoint} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="wh-name">Name</Label>
                  <Input
                    id="wh-name"
                    value={newEndpoint.name}
                    onChange={(e) => setNewEndpoint((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Payroll sync"
                  />
                </div>
                <div>
                  <Label htmlFor="wh-url">URL</Label>
                  <Input
                    id="wh-url"
                    type="url"
                    value={newEndpoint.url}
                    onChange={(e) => setNewEndpoint((p) => ({ ...p, url: e.target.value }))}
                    placeholder="https://example.com/hooks/hr"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="wh-secret">Signing secret (optional)</Label>
                <Input
                  id="wh-secret"
                  type="password"
                  value={newEndpoint.secret}
                  onChange={(e) => setNewEndpoint((p) => ({ ...p, secret: e.target.value }))}
                  placeholder="HMAC-SHA256 secret"
                />
              </div>
              <div>
                <Label>Events</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEBHOOK_EVENTS.map((ev) => (
                    <button
                      key={ev}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs ${
                        newEndpoint.events.includes(ev)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                      onClick={() => toggleNewEvent(ev)}
                    >
                      {ev}
                    </button>
                  ))}
                </div>
              </div>
              <Button type="submit" disabled={busy} className="gap-2">
                <Plus className="h-4 w-4" />
                Add endpoint
              </Button>
            </form>
          </FormCard>

          <FormCard title="Endpoints" description={`${webhookEndpoints.length} configured`}>
            <DataTable>
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead>Name</DataTableHead>
                  <DataTableHead>URL</DataTableHead>
                  <DataTableHead>Events</DataTableHead>
                  <DataTableHead>Status</DataTableHead>
                  <DataTableHead className="w-32">&nbsp;</DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {webhookEndpoints.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No webhook endpoints" />
                ) : (
                  webhookEndpoints.map((ep) => (
                    <DataTableRow key={ep.id}>
                      <DataTableCell className="font-medium">{ep.name}</DataTableCell>
                      <DataTableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Link2 className="h-3 w-3 shrink-0" />
                          {ep.url}
                        </span>
                      </DataTableCell>
                      <DataTableCell className="text-xs text-muted-foreground">
                        {ep.events.length === 0 ? "All events" : ep.events.join(", ")}
                        {ep.has_secret ? " · signed" : ""}
                      </DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={ep.is_active ? "active" : "inactive"} />
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void toggleEndpoint(ep)}
                          >
                            {ep.is_active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void deleteEndpoint(ep.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </DataTable>
          </FormCard>

          <FormCard
            title="Recent deliveries"
            description={`${webhookDeliveryTotal} total · processed by scheduled cron`}
          >
            <DataTable>
              <DataTableHeader>
                <DataTableRow>
                  <DataTableHead>Event</DataTableHead>
                  <DataTableHead>Endpoint</DataTableHead>
                  <DataTableHead>Status</DataTableHead>
                  <DataTableHead>Attempts</DataTableHead>
                  <DataTableHead>Time</DataTableHead>
                </DataTableRow>
              </DataTableHeader>
              <DataTableBody>
                {webhookDeliveries.length === 0 ? (
                  <DataTableEmpty colSpan={5} message="No deliveries yet" />
                ) : (
                  webhookDeliveries.map((d) => (
                    <DataTableRow key={d.id}>
                      <DataTableCell className="font-mono text-xs">{d.event_type}</DataTableCell>
                      <DataTableCell className="text-sm">{d.endpoint_name}</DataTableCell>
                      <DataTableCell>
                        <StatusBadge status={d.status} />
                      </DataTableCell>
                      <DataTableCell>{d.attempts}</DataTableCell>
                      <DataTableCell className="text-xs text-muted-foreground">
                        {d.processed_at
                          ? new Date(d.processed_at).toLocaleString()
                          : new Date(d.created_at).toLocaleString()}
                        {d.last_error ? (
                          <span className="mt-1 block text-destructive">{d.last_error}</span>
                        ) : null}
                      </DataTableCell>
                    </DataTableRow>
                  ))
                )}
              </DataTableBody>
            </DataTable>
          </FormCard>

          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Webhook className="h-4 w-4" />
            Deliveries run via the platform cron worker. Signed payloads use header{" "}
            <code className="text-xs">X-Nexus-Signature</code> (HMAC-SHA256).
          </p>
        </div>
      )}
    </div>
  );
}
