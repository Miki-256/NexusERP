import { cn } from "@/lib/utils";

export function MetricBarChart({
  data,
  className,
}: {
  data: { label: string; value: number; color?: string }[];
  className?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className={cn("space-y-3", className)}>
      {data.map((item) => (
        <div key={item.label} className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-muted-foreground">{item.label}</span>
            <span className="tabular-nums font-semibold">{item.value.toLocaleString()}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all duration-500", item.color ?? "bg-primary")}
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ActivityTimeline({
  items,
}: {
  items: { title: string; meta: string; time: string }[];
}) {
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={i} className="relative flex gap-3 pl-1">
          <div className="relative mt-1.5 flex flex-col items-center">
            <div className="h-2 w-2 rounded-full bg-primary ring-4 ring-primary/10" />
            {i < items.length - 1 && (
              <div className="absolute top-3 h-full w-px bg-border" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <p className="text-sm font-medium">{item.title}</p>
            <p className="text-xs text-muted-foreground">{item.meta}</p>
            <p className="mt-0.5 text-2xs text-muted-foreground">{item.time}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
