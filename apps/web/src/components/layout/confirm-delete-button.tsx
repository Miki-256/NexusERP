"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

type ConfirmDeleteButtonProps = {
  label?: string;
  confirmLabel?: string;
  message?: string;
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
  size?: "sm" | "default";
};

export function ConfirmDeleteButton({
  label,
  confirmLabel,
  message,
  onConfirm,
  disabled,
  size = "sm",
}: ConfirmDeleteButtonProps) {
  const t = useTranslations("common");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm();
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="max-w-[12rem] text-right text-xs text-muted-foreground">
          {message ?? t("cannotBeUndone")}
        </span>
        <Button
          type="button"
          size={size}
          variant="destructive"
          disabled={loading}
          className="cursor-pointer"
          onClick={handleConfirm}
        >
          {loading ? t("deleting") : (confirmLabel ?? t("confirm"))}
        </Button>
        <Button
          type="button"
          size={size}
          variant="ghost"
          disabled={loading}
          className="cursor-pointer"
          onClick={() => setConfirming(false)}
        >
          {t("cancel")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      disabled={disabled}
      className="cursor-pointer text-destructive hover:text-destructive"
      onClick={() => setConfirming(true)}
    >
      <Trash2 className="h-3.5 w-3.5" />
      {label ?? t("delete")}
    </Button>
  );
}
