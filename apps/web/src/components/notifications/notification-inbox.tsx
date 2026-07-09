"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import type { InAppNotification } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

export function NotificationInbox({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<InAppNotification[]>([]);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [countRes, listRes] = await Promise.all([
      supabase.rpc("count_unread_in_app_notifications", { p_org_id: organizationId }),
      supabase.rpc("list_in_app_notifications", { p_org_id: organizationId, p_limit: 15, p_offset: 0 }),
    ]);
    setUnread(typeof countRes.data === "number" ? countRes.data : 0);
    setItems((listRes.data ?? []) as InAppNotification[]);
  }, [organizationId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (open) {
      setLoading(true);
      void refresh().finally(() => setLoading(false));
    }
  }, [open, refresh]);

  async function markRead(id: string) {
    const supabase = createClient();
    await supabase.rpc("mark_in_app_notification_read", { p_notification_id: id });
    await refresh();
  }

  async function markAllRead() {
    const supabase = createClient();
    await supabase.rpc("mark_all_in_app_notifications_read", { p_org_id: organizationId });
    await refresh();
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notifications</span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="inline-flex items-center gap-1 text-xs font-normal text-primary hover:underline"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem key={item.id} asChild className="cursor-pointer items-start p-0">
              <Link
                href={item.link ?? "/communications"}
                onClick={() => {
                  if (!item.read_at) void markRead(item.id);
                  setOpen(false);
                }}
                className={cn(
                  "block w-full px-2 py-2.5",
                  !item.read_at && "bg-primary/5"
                )}
              >
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.body}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                </p>
              </Link>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/communications" className="w-full justify-center text-center text-sm font-medium">
            Open Notification Center
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
