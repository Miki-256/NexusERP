import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "default"> = {
  active: "success",
  completed: "success",
  posted: "success",
  paid: "success",
  won: "success",
  open: "warning",
  pending: "warning",
  ordered: "warning",
  draft: "secondary",
  suspended: "destructive",
  lost: "destructive",
  resolved: "success",
  closed: "secondary",
  approved: "success",
  rejected: "destructive",
  confirmed: "warning",
  done: "success",
  cancelled: "destructive",
  new: "default",
  in_progress: "warning",
  interview: "warning",
  offer: "success",
  hired: "success",
  refused: "destructive",
  voided: "destructive",
  returned: "warning",
  pending_sync: "warning",
  terminated: "destructive",
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase();
  return (
    <Badge variant={STATUS_VARIANT[key] ?? "secondary"} className="capitalize">
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
