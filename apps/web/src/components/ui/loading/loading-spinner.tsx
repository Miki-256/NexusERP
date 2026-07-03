import { cn } from "@/lib/utils";

export function LoadingSpinner({
  className,
  size = "md",
  label,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const dim = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-10 w-10" : "h-5 w-5";

  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="status" aria-live="polite">
      <span
        className={cn(
          "nexus-spinner shrink-0 rounded-full border-2 border-current border-t-transparent",
          dim
        )}
        aria-hidden
      />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}
