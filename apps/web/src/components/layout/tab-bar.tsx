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
    <div
      className={cn(
        "flex gap-0.5 overflow-x-auto border-b border-border scrollbar-thin",
        className
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          className={cn(
            "relative -mb-px shrink-0 cursor-pointer border-b-2 px-2 py-1.5 text-[13px] font-medium transition-colors duration-150 lg:px-2.5",
            value === tab.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1 text-2xs tabular-nums text-muted-foreground">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}
