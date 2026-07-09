import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { TemplatesClient } from "./templates-client";
import type { NotificationTemplateRow } from "@/lib/notifications/types";

export default async function CommunicationsTemplatesPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Manager access is required to edit notification templates.
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_notification_templates", {
    p_org_id: ctx.organization.id,
  });

  return (
    <TemplatesClient
      orgId={ctx.organization.id}
      templates={(data as NotificationTemplateRow[]) ?? []}
    />
  );
}
