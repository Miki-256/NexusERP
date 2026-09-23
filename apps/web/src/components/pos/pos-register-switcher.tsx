"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearPosSession } from "@/lib/pos-session";
import { cn } from "@/lib/utils";
import { ChevronDown, MonitorSmartphone } from "lucide-react";

type StoreRegister = { id: string; name: string; is_current?: boolean };

export function PosRegisterSwitcher({
  registerId,
  registerName,
  tone = "onDark",
  alwaysShowLabel = false,
}: {
  registerId: string;
  registerName: string;
  /** Header sits on navy; open-shift card is light. */
  tone?: "onDark" | "onLight";
  /** Show register label even on narrow viewports (e.g. Tools menu). */
  alwaysShowLabel?: boolean;
}) {
  const t = useTranslations("pos");
  const router = useRouter();
  const [registers, setRegisters] = useState<StoreRegister[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("list_pos_store_registers", {
        p_register_id: registerId,
      });
      if (cancelled || error) return;
      const rows = (Array.isArray(data) ? data : []) as StoreRegister[];
      setRegisters(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [registerId]);

  function switchTo(nextId: string) {
    if (nextId === registerId) return;
    clearPosSession(registerId);
    router.push(`/pos/${nextId}`);
  }

  const triggerClass =
    tone === "onDark"
      ? "h-10 cursor-pointer border-white/20 bg-white/10 px-2.5 text-white hover:bg-white/20 hover:text-white sm:px-3"
      : cn(
          "h-10 cursor-pointer border-slate-200 bg-white px-2.5 text-slate-700 hover:bg-slate-50 sm:px-3",
          alwaysShowLabel && "w-full justify-start"
        );
  const labelClass = alwaysShowLabel
    ? "inline max-w-[12rem] truncate"
    : "hidden max-w-[7rem] truncate sm:inline";

  if (registers.length <= 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={triggerClass}
        onClick={() => router.push("/pos")}
        title={t("selectAnotherRegister")}
        aria-label={t("changeRegister")}
      >
        <MonitorSmartphone className={cn("h-4 w-4", !alwaysShowLabel && "sm:mr-1.5", alwaysShowLabel && "mr-1.5")} aria-hidden />
        <span className={labelClass}>{t("changeRegister")}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={triggerClass}
          title={t("changeRegister")}
          aria-label={t("changeRegister")}
        >
          <MonitorSmartphone className={cn("h-4 w-4", !alwaysShowLabel && "sm:mr-1.5", alwaysShowLabel && "mr-1.5")} aria-hidden />
          <span className={labelClass}>{registerName}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel>{t("registersAtThisStore")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {registers.map((r) => (
          <DropdownMenuItem
            key={r.id}
            disabled={r.id === registerId}
            onClick={() => switchTo(r.id)}
          >
            {r.name}
            {r.id === registerId ? t("currentSuffix") : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/pos")}>{t("allRegisters")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
