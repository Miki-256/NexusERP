export const NOTIFICATION_CHANNELS = [
  "email",
  "whatsapp",
  "telegram",
  "in_app",
  "webhook",
  "sms",
  "push",
  "teams",
  "slack",
] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationDeliveryStatus =
  | "pending"
  | "processing"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "dead_letter"
  | "cancelled";

export type InAppNotification = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  event_type: string | null;
  read_at: string | null;
  created_at: string;
};

export type ClaimedDelivery = {
  id: string;
  organization_id: string;
  event_id: string;
  channel: NotificationChannel;
  recipient_type: string;
  recipient_ref: string;
  subject: string | null;
  body: string;
  body_format: string;
  attachments: unknown;
  attempts: number;
  max_attempts: number;
};

export type NotificationChannelBreakdown = {
  channel: string;
  count: number;
};

export type NotificationCenterDashboard = {
  sent_today: number;
  queued: number;
  failed: number;
  events_pending: number;
  delivery_rate_pct: number;
  channel_breakdown?: NotificationChannelBreakdown[];
};

export type NotificationAnalyticsDaily = {
  date: string;
  sent: number;
  failed: number;
  total: number;
};

export type NotificationAnalyticsChannel = {
  channel: string;
  sent: number;
  failed: number;
  total: number;
};

export type NotificationCenterAnalytics = {
  days: number;
  daily: NotificationAnalyticsDaily[];
  by_channel: NotificationAnalyticsChannel[];
  summary: {
    total_sent: number;
    total_failed: number;
    total: number;
    delivery_rate_pct: number;
  };
};

export type NotificationFailedRow = {
  id: string;
  channel: string;
  recipient_ref: string;
  subject: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  event_type: string | null;
};

export type NotificationAuditLogRow = {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
};

export type NotificationTemplateRow = {
  id: string;
  organization_id: string | null;
  code: string;
  channel: string;
  name: string;
  subject_template: string | null;
  body_template: string;
  body_format: string;
  is_active: boolean;
  is_system: boolean;
  updated_at?: string;
};

export type NotificationEmailSettings = {
  is_enabled: boolean;
  from_name: string;
  from_email: string;
  reply_to?: string | null;
  provider?: string;
};

export type NotificationTelegramSettings = {
  is_enabled: boolean;
  default_chat_id: string;
  has_custom_bot_token: boolean;
  bot_token_hint: string;
};

export type NotificationWhatsAppSettings = {
  is_enabled: boolean;
  phone_number_id: string;
  waba_id: string;
  template_language: string;
  has_custom_access_token: boolean;
  access_token_hint: string;
};

export type NotificationDeliveryHistoryRow = {
  id: string;
  channel: string;
  recipient_ref: string;
  subject: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  event_type: string | null;
};

export type NotificationRuleRow = {
  id: string;
  name: string;
  event_type: string;
  conditions: { field: string; op: string; value: unknown }[];
  channels: string[];
  recipient_spec: Record<string, unknown>;
  template_codes: Record<string, string>;
  store_ids: string[] | null;
  is_active: boolean;
  sort_order: number;
  updated_at?: string;
};

export type NotificationRecipientGroupRow = {
  id: string;
  name: string;
  member_user_ids: string[];
  member_emails: string[];
  member_phones: string[];
  telegram_chat_ids: string[];
  updated_at?: string;
};

export type NotificationScheduleRow = {
  id: string;
  name: string;
  report_type: string;
  preset: "daily" | "weekly" | "monthly";
  run_at_hour: number;
  run_at_minute: number;
  timezone: string;
  channels: string[];
  recipient_spec: Record<string, unknown>;
  export_format: "csv" | "pdf" | "xlsx";
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
  updated_at?: string;
};

export const REPORT_TYPE_OPTIONS = [
  { value: "sales.daily", label: "Daily sales" },
  { value: "sales.weekly", label: "Weekly sales (7 days)" },
  { value: "financial.pnl", label: "Monthly GL P&L" },
  { value: "financial.balance_sheet", label: "Balance sheet" },
  { value: "financial.executive", label: "Executive KPI summary" },
  { value: "financial.ar_aging", label: "AR aging" },
  { value: "inventory.stock", label: "Low stock items" },
] as const;

export const SCHEDULE_PRESETS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly (Monday)" },
  { value: "monthly", label: "Monthly (1st)" },
] as const;

export type NotificationQueueRow = {
  id: string;
  row_kind?: "delivery" | "event";
  channel: string;
  recipient_ref: string;
  subject: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  event_type: string | null;
  event_id: string;
};
