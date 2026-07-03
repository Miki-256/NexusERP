import { cn } from "@/lib/utils";
import type { BroadcastBanner } from "@/lib/admin-types";

const VARIANT: Record<BroadcastBanner["variant"], string> = {
  info: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100",
  warning: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
  critical: "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100",
};

export function PlatformBanner({ banner }: { banner: BroadcastBanner | null }) {
  if (!banner?.enabled || !banner.message.trim()) return null;

  return (
    <div
      className={cn(
        "border-b px-4 py-2 text-center text-sm font-medium",
        VARIANT[banner.variant] ?? VARIANT.info
      )}
      role="status"
    >
      {banner.message}
    </div>
  );
}
