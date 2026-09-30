"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FormCard } from "@/components/layout/form-card";
import { LoadingButton } from "@/components/ui/loading";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/components/ui/toast";

export function ChangePasswordCard({
  email,
  idPrefix = "account",
}: {
  email?: string | null;
  idPrefix?: string;
}) {
  const t = useTranslations("settings");
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: t("passwordTooShort"), variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t("passwordsDoNotMatch"), variant: "destructive" });
      return;
    }
    if (newPassword === currentPassword) {
      toast({ title: t("passwordUnchanged"), variant: "destructive" });
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    setLoading(false);

    if (!res.ok) {
      const error = payload.error ?? "";
      const description =
        res.status === 429 || error.toLowerCase().includes("too many")
          ? t("passwordTooManyAttempts")
          : error === "Current password is incorrect"
            ? t("currentPasswordIncorrect")
            : error || undefined;
      toast({
        title: t("passwordChangeFailed"),
        description,
        variant: "destructive",
      });
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    toast({ title: t("passwordUpdated"), description: t("passwordUpdatedHelp") });
  }

  return (
    <FormCard
      title={t("accountTitle")}
      description={email ? t("accountHelpEmail", { email }) : t("accountHelp")}
      onSubmit={handleSubmit}
    >
      <div className="max-w-md space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-current-password`}>{t("currentPassword")}</Label>
          <PasswordInput
            id={`${idPrefix}-current-password`}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-new-password`}>{t("newPassword")}</Label>
          <PasswordInput
            id={`${idPrefix}-new-password`}
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-confirm-password`}>{t("confirmPassword")}</Label>
          <PasswordInput
            id={`${idPrefix}-confirm-password`}
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <LoadingButton type="submit" size="sm" loading={loading} loadingLabel={t("updatingPassword")}>
          {t("updatePassword")}
        </LoadingButton>
      </div>
    </FormCard>
  );
}
