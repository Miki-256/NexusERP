import { cn } from "@/lib/utils";

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 border-b border-border", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            "relative -mb-px cursor-pointer border-b-2 px-4 py-2.5 text-sm font-medium transition-colors duration-150",
            value === tab.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}
