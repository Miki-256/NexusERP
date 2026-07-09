"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { CommunicationsSubNav } from "../communications-sub-nav";
import { parseRpcJsonArray } from "@/lib/notifications/parse-rpc-json";
import {
  REPORT_TYPE_OPTIONS,
  SCHEDULE_PRESETS,
  type NotificationScheduleRow,
} from "@/lib/notifications/types";

const CHANNEL_OPTIONS = ["email", "telegram", "in_app"] as const;
const FORMAT_OPTIONS = ["csv", "pdf", "xlsx"] as const;

export function SchedulesClient({
  orgId,
  orgTimezone,
  schedules: initial,
}: {
  orgId: string;
  orgTimezone: string;
  schedules: NotificationScheduleRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [schedules, setSchedules] = useState(initial);
  const [busy, setBusy] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<NotificationScheduleRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    report_type: "sales.daily",
    preset: "daily" as NotificationScheduleRow["preset"],
    run_at_hour: 7,
    run_at_minute: 0,
    export_format: "csv" as NotificationScheduleRow["export_format"],
    channels: ["email"] as string[],
    use_default_chat: false,
    roles: ["owner", "manager"] as string[],
  });

  function openCreate() {
    setEditing(null);
    setShowForm(true);
    setForm({
      name: "",
      report_type: "sales.daily",
      preset: "daily",
      run_at_hour: 7,
      run_at_minute: 0,
      export_format: "csv",
      channels: ["telegram"],
      use_default_chat: true,
      roles: ["owner", "manager"],
    });
  }

  function openEdit(schedule: NotificationScheduleRow) {
    setEditing(schedule);
    setShowForm(true);
    const spec = schedule.recipient_spec ?? {};
    setForm({
      name: schedule.name,
      report_type: schedule.report_type,
      preset: schedule.preset,
      run_at_hour: schedule.run_at_hour,
      run_at_minute: schedule.run_at_minute,
      export_format: schedule.export_format,
      channels: [...schedule.channels],
      use_default_chat: spec.use_default_chat === true,
      roles: Array.isArray(spec.roles) ? (spec.roles as string[]) : ["owner", "manager"],
    });
  }

  async function reload() {
    const supabase = createClient();
    const { data } = await supabase.rpc("list_notification_schedules", { p_org_id: orgId });
    setSchedules(parseRpcJsonArray<NotificationScheduleRow>(data));
    router.refresh();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    const supabase = createClient();

    const recipient_spec: Record<string, unknown> = {};
    if (form.use_default_chat) {
      recipient_spec.use_default_chat = true;
    } else if (form.roles.length > 0) {
      recipient_spec.roles = form.roles;
    }

    const { error } = await supabase.rpc("upsert_notification_schedule", {
      p_org_id: orgId,
      p_schedule_id: editing?.id ?? null,
      p_name: form.name.trim(),
      p_report_type: form.report_type,
      p_preset: form.preset,
      p_run_at_hour: form.run_at_hour,
      p_run_at_minute: form.run_at_minute,
      p_timezone: orgTimezone,
      p_channels: form.channels,
      p_recipient_spec: recipient_spec,
      p_export_format: form.export_format,
      p_is_active: editing?.is_active ?? false,
    });

    setBusy("");
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Schedule updated" : "Schedule created" });
    setShowForm(false);
    setEditing(null);
    await reload();
  }

  async function toggleActive(schedule: NotificationScheduleRow) {
    setBusy(schedule.id);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_notification_schedule", {
      p_org_id: orgId,
      p_schedule_id: schedule.id,
      p_name: schedule.name,
      p_report_type: schedule.report_type,
      p_preset: schedule.preset,
      p_run_at_hour: schedule.run_at_hour,
      p_run_at_minute: schedule.run_at_minute,
      p_timezone: schedule.timezone,
      p_channels: schedule.channels,
      p_recipient_spec: schedule.recipient_spec,
      p_export_format: schedule.export_format,
      p_is_active: !schedule.is_active,
    });
    setBusy("");
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    await reload();
  }

  const showFormPanel = showForm;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Scheduled reports"
        description="Automated daily, weekly, and monthly reports delivered by email, Telegram, or in-app."
        action={
          <Button size="sm" onClick={openCreate}>
            New schedule
          </Button>
        }
      />
      <CommunicationsSubNav active="/communications/schedules" />

      {showFormPanel && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-base">{editing ? "Edit schedule" : "New schedule"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Report</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.report_type}
                    onChange={(e) => setForm((f) => ({ ...f, report_type: e.target.value }))}
                  >
                    {REPORT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.preset}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        preset: e.target.value as NotificationScheduleRow["preset"],
                      }))
                    }
                  >
                    {SCHEDULE_PRESETS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Hour (0–23)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={form.run_at_hour}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, run_at_hour: Number(e.target.value) }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Minute</Label>
                  <Input
                    type="number"
                    min={0}
                    max={59}
                    value={form.run_at_minute}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, run_at_minute: Number(e.target.value) }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.export_format}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        export_format: e.target.value as NotificationScheduleRow["export_format"],
                      }))
                    }
                  >
                    {FORMAT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Channels</Label>
                <div className="flex flex-wrap gap-3">
                  {CHANNEL_OPTIONS.map((ch) => (
                    <label key={ch} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.channels.includes(ch)}
                        onChange={(e) => {
                          setForm((f) => ({
                            ...f,
                            channels: e.target.checked
                              ? [...f.channels, ch]
                              : f.channels.filter((c) => c !== ch),
                          }));
                        }}
                      />
                      {ch}
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.use_default_chat}
                  onChange={(e) => setForm((f) => ({ ...f, use_default_chat: e.target.checked }))}
                />
                Send to Telegram default group chat
              </label>
              {!form.use_default_chat && (
                <p className="text-xs text-muted-foreground">
                  Recipients: owner and manager roles (email / in-app).
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={busy === "save"}>
                  {busy === "save" ? "Saving…" : "Save schedule"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    setEditing(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No schedules yet. Create one or refresh to load presets.</p>
          ) : (
            schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="flex flex-col gap-2 rounded-lg border border-border/60 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{schedule.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {schedule.report_type} · {schedule.preset} at {String(schedule.run_at_hour).padStart(2, "0")}:
                    {String(schedule.run_at_minute).padStart(2, "0")} ({schedule.timezone}) ·{" "}
                    {schedule.export_format.toUpperCase()}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {schedule.channels.map((ch) => (
                      <Badge key={ch} variant="secondary">
                        {ch}
                      </Badge>
                    ))}
                    <Badge variant={schedule.is_active ? "default" : "outline"}>
                      {schedule.is_active ? "active" : "inactive"}
                    </Badge>
                  </div>
                  {schedule.next_run_at && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Next run: {new Date(schedule.next_run_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(schedule)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant={schedule.is_active ? "secondary" : "default"}
                    disabled={busy === schedule.id}
                    onClick={() => toggleActive(schedule)}
                  >
                    {schedule.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
