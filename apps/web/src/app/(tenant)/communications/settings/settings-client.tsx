"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { CommunicationsSubNav } from "../communications-sub-nav";
import type {
  NotificationEmailSettings,
  NotificationTelegramSettings,
  NotificationWhatsAppSettings,
} from "@/lib/notifications/types";

export function SettingsClient({
  orgId,
  emailSettings: initialEmail,
  telegramSettings: initialTelegram,
  whatsappSettings: initialWhatsapp,
}: {
  orgId: string;
  emailSettings: NotificationEmailSettings;
  telegramSettings: NotificationTelegramSettings;
  whatsappSettings: NotificationWhatsAppSettings;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [emailEnabled, setEmailEnabled] = useState(initialEmail.is_enabled);
  const [fromName, setFromName] = useState(initialEmail.from_name);
  const [fromEmail, setFromEmail] = useState(initialEmail.from_email);
  const [replyTo, setReplyTo] = useState(initialEmail.reply_to ?? "");
  const [savingEmail, setSavingEmail] = useState(false);

  const [telegramEnabled, setTelegramEnabled] = useState(initialTelegram.is_enabled);
  const [defaultChatId, setDefaultChatId] = useState(initialTelegram.default_chat_id);
  const [botToken, setBotToken] = useState("");
  const [clearBotToken, setClearBotToken] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);

  const [whatsappEnabled, setWhatsappEnabled] = useState(initialWhatsapp.is_enabled);
  const [phoneNumberId, setPhoneNumberId] = useState(initialWhatsapp.phone_number_id);
  const [wabaId, setWabaId] = useState(initialWhatsapp.waba_id);
  const [templateLanguage, setTemplateLanguage] = useState(initialWhatsapp.template_language || "en");
  const [accessToken, setAccessToken] = useState("");
  const [clearAccessToken, setClearAccessToken] = useState(false);
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);

  const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const webhookUrl = appBase ? `${appBase}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_notification_email_settings", {
      p_org_id: orgId,
      p_is_enabled: emailEnabled,
      p_from_name: fromName,
      p_from_email: fromEmail,
      p_reply_to: replyTo || null,
    });
    setSavingEmail(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Email settings saved",
      description: emailEnabled
        ? "Team invites and invoice reminders will send when events are queued."
        : "Email channel disabled — events will not create email deliveries.",
    });
    router.refresh();
  }

  async function saveTelegram(e: React.FormEvent) {
    e.preventDefault();
    setSavingTelegram(true);
    const supabase = createClient();

    let tokenArg: string | null = null;
    if (clearBotToken) {
      tokenArg = "";
    } else if (botToken.trim()) {
      tokenArg = botToken.trim();
    }

    const { error } = await supabase.rpc("upsert_notification_telegram_settings", {
      p_org_id: orgId,
      p_is_enabled: telegramEnabled,
      p_default_chat_id: defaultChatId,
      p_bot_token: tokenArg,
    });
    setSavingTelegram(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setBotToken("");
    setClearBotToken(false);
    toast({
      title: "Telegram settings saved",
      description: telegramEnabled
        ? "Enable rules under Communications → Rules to send POS alerts and daily sales reports."
        : "Telegram channel disabled.",
    });
    router.refresh();
  }

  async function saveWhatsapp(e: React.FormEvent) {
    e.preventDefault();
    setSavingWhatsapp(true);
    const supabase = createClient();

    let tokenArg: string | null = null;
    if (clearAccessToken) {
      tokenArg = "";
    } else if (accessToken.trim()) {
      tokenArg = accessToken.trim();
    }

    const { error } = await supabase.rpc("upsert_notification_whatsapp_settings", {
      p_org_id: orgId,
      p_is_enabled: whatsappEnabled,
      p_phone_number_id: phoneNumberId,
      p_waba_id: wabaId || null,
      p_template_language: templateLanguage || "en",
      p_access_token: tokenArg,
    });
    setSavingWhatsapp(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setAccessToken("");
    setClearAccessToken(false);
    toast({
      title: "WhatsApp settings saved",
      description: whatsappEnabled
        ? "Enable WhatsApp rules under Communications → Rules. Meta templates must be approved in Business Manager."
        : "WhatsApp channel disabled.",
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Channel settings"
        description="Configure email, Telegram, and WhatsApp. Platform API keys can be set in server environment variables."
      />
      <CommunicationsSubNav active="/communications/settings" />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Email (Resend)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveEmail} className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Enable email notifications for this organization
            </label>
            <div className="space-y-2">
              <Label>From name</Label>
              <Input
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Your company name"
              />
            </div>
            <div className="space-y-2">
              <Label>From email</Label>
              <Input
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="notifications@yourdomain.com"
              />
              <p className="text-xs text-muted-foreground">
                Must be a verified domain in Resend, or leave blank to use platform NOTIFICATION_FROM_EMAIL.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Reply-to (optional)</Label>
              <Input
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="support@yourdomain.com"
              />
            </div>
            <Button type="submit" disabled={savingEmail}>
              {savingEmail ? "Saving…" : "Save email settings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Telegram</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveTelegram} className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={telegramEnabled}
                onChange={(e) => setTelegramEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Enable Telegram notifications for this organization
            </label>
            <div className="space-y-2">
              <Label>Default group chat ID</Label>
              <Input
                value={defaultChatId}
                onChange={(e) => setDefaultChatId(e.target.value)}
                placeholder="-1001234567890"
              />
              <p className="text-xs text-muted-foreground">
                Add your bot to the group, then use @userinfobot or Telegram API getUpdates to find the chat ID.
                Rules with &quot;default chat&quot; send here.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Bot token (optional override)</Label>
              <PasswordInput
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={
                  initialTelegram.has_custom_bot_token
                    ? `Current: ${initialTelegram.bot_token_hint}`
                    : "Leave blank to use platform TELEGRAM_BOT_TOKEN"
                }
                autoComplete="off"
                toggleLabel="Show bot token"
              />
              {initialTelegram.has_custom_bot_token ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearBotToken}
                    onChange={(e) => setClearBotToken(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-input"
                  />
                  Remove custom bot token (use platform default)
                </label>
              ) : null}
            </div>
            <Button type="submit" disabled={savingTelegram}>
              {savingTelegram ? "Saving…" : "Save Telegram settings"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">WhatsApp (Meta Cloud API)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveWhatsapp} className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={whatsappEnabled}
                onChange={(e) => setWhatsappEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Enable WhatsApp notifications for this organization
            </label>
            <div className="space-y-2">
              <Label>Phone number ID</Label>
              <Input
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="From Meta Developer → WhatsApp → API setup"
              />
            </div>
            <div className="space-y-2">
              <Label>WABA ID (optional)</Label>
              <Input
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                placeholder="WhatsApp Business Account ID"
              />
            </div>
            <div className="space-y-2">
              <Label>Default template language</Label>
              <Input
                value={templateLanguage}
                onChange={(e) => setTemplateLanguage(e.target.value)}
                placeholder="en"
              />
            </div>
            <div className="space-y-2">
              <Label>Access token (optional override)</Label>
              <PasswordInput
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={
                  initialWhatsapp.has_custom_access_token
                    ? `Current: ${initialWhatsapp.access_token_hint}`
                    : "Leave blank to use platform WHATSAPP_ACCESS_TOKEN"
                }
                autoComplete="off"
                toggleLabel="Show access token"
              />
              {initialWhatsapp.has_custom_access_token ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearAccessToken}
                    onChange={(e) => setClearAccessToken(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-input"
                  />
                  Remove custom access token (use platform default)
                </label>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Delivery webhook URL: <span className="font-mono">{webhookUrl}</span>
              <br />
              Set <span className="font-mono">WHATSAPP_WEBHOOK_VERIFY_TOKEN</span> in Vercel for Meta subscription
              verification.
            </p>
            <Button type="submit" disabled={savingWhatsapp}>
              {savingWhatsapp ? "Saving…" : "Save WhatsApp settings"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
