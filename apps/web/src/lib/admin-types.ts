export type PlatformAdminRole = "super_admin" | "support" | "security";

export type PlatformAdminContext = {
  isAdmin: true;
  role: PlatformAdminRole;
  canWrite: boolean;
  canManageAdmins: boolean;
};

export type AdminOrg = {
  id: string;
  name: string;
  status: "pending" | "active" | "suspended";
  plan: string;
  currency: string;
  member_count: number;
  created_at: string;
  owner_email?: string | null;
};

export type PendingOrg = AdminOrg & { owner_email: string | null };

export type PlatformAdmin = {
  user_id: string;
  email: string;
  role: PlatformAdminRole;
  created_at: string;
};

export type PlatformAuditLog = {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  organization_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type OrgDetail = {
  organization: {
    id: string;
    name: string;
    status: "pending" | "active" | "suspended";
    plan: string;
    currency: string;
    timezone: string;
    tax_rate: number;
    created_at: string;
    updated_at: string;
  };
  members: {
    member_id: string;
    user_id: string;
    email: string;
    role: string;
    is_active: boolean;
    joined_at: string;
  }[];
  stores: {
    store_id: string;
    name: string;
    created_at: string;
  }[];
  status_history: {
    id: string;
    action: string;
    actor_email: string | null;
    payload: Record<string, unknown>;
    created_at: string;
  }[];
  support_notes: SupportNote[];
  stats: {
    sales_count: number;
    sales_total: number;
  };
};

export type SupportNote = {
  id: string;
  note: string;
  author_email: string | null;
  created_at: string;
};

export type AdminUserSearchResult = {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  org_count: number;
  is_platform_admin: boolean;
};

export type UserMembership = {
  organization_id: string;
  organization_name: string;
  organization_status: string;
  member_id: string;
  role: string;
  is_active: boolean;
  joined_at: string;
};

export type UserProfile = {
  user: {
    id: string;
    email: string;
    created_at: string;
    last_sign_in_at: string | null;
    email_confirmed_at: string | null;
  };
  is_platform_admin: boolean;
  platform_admin_role: PlatformAdminRole | null;
  memberships: UserMembership[];
  security?: UserSecurityInfo;
};

export type UserSecurityInfo = {
  user_id: string;
  email: string;
  is_disabled: boolean;
  disabled_reason: string | null;
  disabled_at: string | null;
  banned_until: string | null;
};

export type AccessDebugResult = {
  user_id: string;
  organization_id: string | null;
  can_access: boolean;
  summary: string;
  checks: { label: string; pass: boolean; detail: string }[];
};

export type AuthPolicies = {
  id: string;
  max_login_failures_email: number;
  login_lockout_minutes: number;
  login_failure_window_minutes: number;
  max_login_failures_ip: number;
  max_pin_failures: number;
  pin_lockout_minutes: number;
  max_manager_pin_failures_register: number;
  updated_at: string;
};

export type AuthLockout = {
  lockout_type: string;
  identifier: string;
  failed_attempts: number;
  locked_until: string | null;
  last_attempt_at: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
};

export type SecurityAlertSettings = {
  enabled: boolean;
  webhook_url: string;
  notify_slack: boolean;
};

export type SecurityDashboard = {
  stats: {
    failed_logins_24h: number;
    login_blocked_24h: number;
    active_lockouts: number;
    suspended_orgs: number;
    pending_orgs: number;
    disabled_users: number;
    admin_actions_24h: number;
  };
  suspended_organizations: {
    id: string;
    name: string;
    status: string;
    created_at: string;
  }[];
  recent_security_events: {
    id: string;
    event_type: string;
    email: string | null;
    ip_address: string | null;
    created_at: string;
  }[];
  recent_admin_actions: {
    id: string;
    action: string;
    actor_email: string | null;
    created_at: string;
  }[];
};

export type SecurityEvent = {
  id: string;
  event_type: string;
  email: string | null;
  user_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TenantLookupResult = {
  found: boolean;
  email: string;
  user: UserProfile["user"] | null;
  memberships: UserMembership[];
  pending_invites: {
    invite_id: string;
    organization_id: string;
    organization_name: string;
    role: string;
    created_at: string;
  }[];
};

export type BroadcastBanner = {
  enabled: boolean;
  message: string;
  variant: "info" | "warning" | "critical";
};

export type MaintenanceMode = {
  enabled: boolean;
  message: string;
  block_signup: boolean;
};

export type PlatformSettings = {
  broadcast_banner: BroadcastBanner;
  maintenance_mode: MaintenanceMode;
};

export type PlatformStats = {
  org_count: number;
  orgs_active: number;
  orgs_pending: number;
  orgs_suspended: number;
  member_count: number;
  sales_count: number;
  sales_total: number;
  admin_count: number;
};

export type PlatformPlan = {
  id: string;
  name: string;
  max_stores: number | null;
  max_members: number | null;
  max_sales_per_month: number | null;
  modules: string[] | null;
  org_count: number;
};

export type OrgPlanUsage = {
  organization_id: string;
  plan: string;
  plan_name: string;
  limits: {
    max_stores: number | null;
    max_members: number | null;
    max_sales_per_month: number | null;
    modules: string[] | null;
  };
  usage: {
    stores: number;
    members: number;
    sales_this_month: number;
  };
  within_limits: {
    stores: boolean;
    members: boolean;
    sales: boolean;
  };
};

export type PlatformFeatureFlag = {
  key: string;
  label: string;
  description: string | null;
  enabled: boolean;
  updated_at: string;
};

export type PlatformHealth = {
  generated_at: string;
  table_counts: Record<string, number>;
  estimated_rows: number;
  orgs_by_status: {
    active: number;
    pending: number;
    suspended: number;
  };
  orgs_by_plan: Record<string, number>;
  recent_org_activity: {
    organization_id: string;
    organization_name: string;
    plan: string;
    status: string;
    last_sale_at: string | null;
    sales_count: number;
  }[];
  inactive_orgs_30d: number;
  ops?: {
    ledger_queue_pending: number;
    ledger_queue_failed: number;
    ledger_queue_oldest_at?: string | null;
    payment_webhook_queue_pending: number;
    payment_webhook_oldest_at?: string | null;
    refund_ledger_pending?: number;
    refund_ledger_failed?: number;
    notification_deliveries_pending?: number;
    notification_deliveries_failed?: number;
    notification_events_unprocessed?: number;
    hr_webhook_pending?: number;
    hr_webhook_failed?: number;
    stale_rollup_orgs?: number;
    unposted_completed_sales?: number;
    ledger_queue_errors: {
      sale_id: string;
      organization_id: string;
      organization_name?: string | null;
      attempts: number;
      last_error: string | null;
      enqueued_at: string;
    }[];
    org_ledger_backlog?: {
      organization_id: string;
      organization_name: string | null;
      pending: number;
      failed: number;
      oldest_enqueued_at: string | null;
    }[];
    org_unposted_sales?: {
      organization_id: string;
      organization_name: string | null;
      unposted: number;
      auto_post_enabled: boolean;
    }[];
    process_queue_heartbeat?: {
      key: string;
      last_success_at: string;
      updated_at: string;
      last_ok: boolean;
      last_result?: Record<string, unknown>;
    } | null;
  };
};

export const ROLE_LABELS: Record<PlatformAdminRole, string> = {
  super_admin: "Super Admin",
  support: "App Support",
  security: "Security (read-only)",
};

export function formatAuditAction(action: string) {
  return action.replace(/\./g, " · ").replace(/_/g, " ");
}
