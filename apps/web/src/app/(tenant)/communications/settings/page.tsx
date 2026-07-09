import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { SettingsClient } from "./settings-client";
import type {
  NotificationEmailSettings,
  NotificationTelegramSettings,
  NotificationWhatsAppSettings,
} from "@/lib/notifications/types";

export default async function CommunicationsSettingsPage() {
  const ctx = await requireAppAccess("communications");
  if (!ctx.canManageCommunications) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Manager access is required to configure notification channels.
      </div>
    );
  }

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: emailData }, { data: telegramData }, { data: whatsappData }] = await Promise.all([
    supabase.rpc("get_notification_email_settings", { p_org_id: orgId }),
    supabase.rpc("get_notification_telegram_settings", { p_org_id: orgId }),
    supabase.rpc("get_notification_whatsapp_settings", { p_org_id: orgId }),
  ]);

  const emailSettings = (emailData ?? {
    is_enabled: false,
    from_name: "",
    from_email: "",
    reply_to: "",
  }) as NotificationEmailSettings;

  const telegramSettings = (telegramData ?? {
    is_enabled: false,
    default_chat_id: "",
    has_custom_bot_token: false,
    bot_token_hint: "",
  }) as NotificationTelegramSettings;

  const whatsappSettings = (whatsappData ?? {
    is_enabled: false,
    phone_number_id: "",
    waba_id: "",
    template_language: "en",
    has_custom_access_token: false,
    access_token_hint: "",
  }) as NotificationWhatsAppSettings;

  return (
    <SettingsClient
      orgId={orgId}
      emailSettings={emailSettings}
      telegramSettings={telegramSettings}
      whatsappSettings={whatsappSettings}
    />
  );
}
