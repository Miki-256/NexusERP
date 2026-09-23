import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium capitalize",
  {
    variants: {
      variant: {
        default: "border-border bg-muted/50 text-foreground",
        secondary: "border-border bg-background text-muted-foreground",
        success:
          "border-success/25 bg-success/10 text-success dark:border-success/40 dark:bg-success/15",
        warning:
          "border-warning/25 bg-warning/10 text-warning dark:border-warning/40 dark:bg-warning/15",
        destructive:
          "border-destructive/25 bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/15",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
