"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { ChevronDown, MonitorSmartphone } from "lucide-react";

type StoreRegister = { id: string; name: string; is_current?: boolean };

export function PosRegisterSwitcher({
  registerId,
  registerName,
  tone = "onDark",
}: {
  registerId: string;
  registerName: string;
  /** Header sits on navy; open-shift card is light. */
  tone?: "onDark" | "onLight";
}) {
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
      : "h-10 cursor-pointer border-slate-200 bg-white px-2.5 text-slate-700 hover:bg-slate-50 sm:px-3";

  if (registers.length <= 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={triggerClass}
        onClick={() => router.push("/pos")}
        title="Select another register"
        aria-label="Change register"
      >
        <MonitorSmartphone className="h-4 w-4 sm:mr-1.5" aria-hidden />
        <span className="hidden max-w-[7rem] truncate sm:inline">Change register</span>
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
          title="Change register"
          aria-label="Change register"
        >
          <MonitorSmartphone className="h-4 w-4 sm:mr-1.5" aria-hidden />
          <span className="hidden max-w-[7rem] truncate sm:inline">{registerName}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel>Registers at this store</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {registers.map((r) => (
          <DropdownMenuItem
            key={r.id}
            disabled={r.id === registerId}
            onClick={() => switchTo(r.id)}
          >
            {r.name}
            {r.id === registerId ? " (current)" : ""}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/pos")}>All registers…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
