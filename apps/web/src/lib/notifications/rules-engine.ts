/** Condition operators supported by the SQL rules engine (migration 00083). */
export const NOTIFICATION_CONDITION_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "in"] as const;

export type NotificationConditionOp = (typeof NOTIFICATION_CONDITION_OPS)[number];

export type NotificationRuleCondition = {
  field: string;
  op: NotificationConditionOp;
  value: string | number | string[];
};

export type NotificationRecipientSpec = {
  roles?: string[];
  user_ids?: string[];
  group_ids?: string[];
  emails?: string[];
};

export { type NotificationRuleRow, type NotificationRecipientGroupRow, type NotificationQueueRow } from "./types";

/** Example conditions for UI helpers. */
export const RULE_CONDITION_EXAMPLES: NotificationRuleCondition[] = [
  { field: "payload.total", op: "gt", value: 10000 },
  { field: "payload.store_id", op: "in", value: [] },
];
