import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildReportSummaryText,
  exportScheduledReport,
  type ScheduledReportData,
} from "./report-export";

export type NotificationScheduleRow = {
  id: string;
  organization_id: string;
  name: string;
  report_type: string;
  preset: string;
  run_at_hour: number;
  run_at_minute: number;
  timezone: string;
  channels: string[];
  recipient_spec: Record<string, unknown>;
  export_format: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
};

export type ScheduleRunnerResult = {
  claimed: number;
  deliveries_created: number;
  errors: string[];
};

export async function runNotificationSchedules(
  admin: SupabaseClient,
  limit = 20
): Promise<ScheduleRunnerResult> {
  const result: ScheduleRunnerResult = { claimed: 0, deliveries_created: 0, errors: [] };

  const { data: claimRaw, error: claimError } = await admin.rpc("claim_due_notification_schedules", {
    p_limit: limit,
  });
  if (claimError) {
    result.errors.push(claimError.message);
    return result;
  }

  const claim = (claimRaw ?? {}) as { claimed?: number; schedules?: NotificationScheduleRow[] };
  const schedules = claim.schedules ?? [];
  result.claimed = claim.claimed ?? schedules.length;

  for (const schedule of schedules) {
    try {
      const created = await processOneSchedule(admin, schedule);
      result.deliveries_created += created;
    } catch (err) {
      result.errors.push(
        `${schedule.name}: ${err instanceof Error ? err.message : "Schedule run failed"}`
      );
    }
  }

  return result;
}

async function processOneSchedule(
  admin: SupabaseClient,
  schedule: NotificationScheduleRow
): Promise<number> {
  const orgId = schedule.organization_id;

  const { data: reportRaw, error: reportError } = await admin.rpc("get_scheduled_report_data_internal", {
    p_org_id: orgId,
    p_report_type: schedule.report_type,
  });
  if (reportError) throw new Error(reportError.message);

  const reportData = (reportRaw ?? {}) as ScheduledReportData;
  const exported = await exportScheduledReport(schedule.export_format, reportData);

  const storagePath = `${orgId}/${schedule.id}/${Date.now()}.${exported.extension}`;
  const { error: uploadError } = await admin.storage
    .from("notification-reports")
    .upload(storagePath, exported.buffer, {
      contentType: exported.mimeType,
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { data: signed, error: signError } = await admin.storage
    .from("notification-reports")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  if (signError || !signed?.signedUrl) throw new Error(signError?.message ?? "Signed URL failed");

  const subject = `${schedule.name} — ${reportData.org_name ?? "Nexus ERP"}`;
  const body = buildReportSummaryText(reportData, signed.signedUrl);
  const attachments = [
    {
      type: "document",
      url: signed.signedUrl,
      filename: exported.filename,
      mime_type: exported.mimeType,
      storage_path: storagePath,
    },
  ];

  const { data: created, error: deliveryError } = await admin.rpc(
    "create_scheduled_report_deliveries",
    {
      p_schedule_id: schedule.id,
      p_subject: subject,
      p_body: body,
      p_attachments: attachments,
    }
  );
  if (deliveryError) throw new Error(deliveryError.message);

  return Number(created ?? 0);
}
