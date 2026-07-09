/** Mirrors SQL `_render_notification_template` — `{{key}}` placeholders. */
export function renderNotificationTemplate(
  template: string,
  payload: Record<string, unknown>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = payload[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}
