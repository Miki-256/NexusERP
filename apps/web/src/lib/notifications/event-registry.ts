/** Canonical notification event types — extend as modules integrate. */
export const NOTIFICATION_EVENT_TYPES = {
  POS_SALE_COMPLETED: "pos.sale_completed",
  POS_SALE_VOIDED: "pos.sale_voided",
  POS_REFUND_COMPLETED: "pos.refund_completed",
  POS_SHIFT_OPENED: "pos.shift_opened",
  POS_SHIFT_CLOSED: "pos.shift_closed",
  INVENTORY_LOW_STOCK: "inventory.low_stock",
  INVENTORY_OUT_OF_STOCK: "inventory.out_of_stock",
  INVENTORY_STOCK_ADJUSTMENT: "inventory.stock_adjustment",
  ACCOUNTING_PAYMENT_RECEIVED: "accounting.payment_received",
  ACCOUNTING_INVOICE_REMINDER: "accounting.invoice_reminder",
  ACCOUNTING_JOURNAL_POSTED: "accounting.journal_posted",
  CRM_CUSTOMER_CREATED: "crm.customer_created",
  CRM_COMPLAINT_LOGGED: "crm.complaint_logged",
  TEAM_INVITE_CREATED: "team.invite_created",
  HR_LEAVE_REQUESTED: "hr.leave_requested",
  HR_LEAVE_REVIEWED: "hr.leave_reviewed",
  HR_PAYROLL_COMPLETED: "hr.payroll_completed",
  SECURITY_LOGIN_FAILED: "security.login_failed",
  SYSTEM_QUEUE_BACKLOG: "system.queue_backlog",
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];
