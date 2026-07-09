"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { StatusBadge } from "@/components/layout/status-badge";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { TablePagination } from "@/components/layout/table-toolbar";
import { runHrMutation } from "@/lib/hr/mutations";
import type { OnboardingTaskRow } from "@/lib/hr/types";
import { CheckCircle2 } from "lucide-react";

export function OnboardingTab({
  organizationId,
  canManage,
  tasks,
  total,
  page,
  pageSize,
  onPageChange,
  onChanged,
}: {
  organizationId: string;
  canManage: boolean;
  tasks: OnboardingTaskRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function completeTask(id: string) {
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("update_onboarding_task", {
          p_task_id: id,
          p_status: "completed",
        });
        return { error };
      },
      { successTitle: "Task completed" }
    );
    onChanged();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Checklists created automatically when applicants are hired. {canManage ? "HR can mark tasks complete for any hire." : "Complete your assigned onboarding steps."}
      </p>

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Employee</DataTableHead>
            <DataTableHead>Task</DataTableHead>
            <DataTableHead>Category</DataTableHead>
            <DataTableHead>Due</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead align="right">Action</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {tasks.length === 0 ? (
              <DataTableEmpty colSpan={6} message="No onboarding tasks yet. Hire an applicant to seed a checklist." />
            ) : (
              tasks.map((t) => (
                <DataTableRow key={t.id}>
                  <DataTableCell className="font-medium">{t.employee_name}</DataTableCell>
                  <DataTableCell>{t.title}</DataTableCell>
                  <DataTableCell className="capitalize text-muted-foreground">{t.category}</DataTableCell>
                  <DataTableCell>{t.due_date ?? "—"}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={t.status} />
                  </DataTableCell>
                  <DataTableCell align="right">
                    {t.status !== "completed" && (
                      <Button size="sm" variant="outline" onClick={() => void completeTask(t.id)}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Done
                      </Button>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>

      <TablePagination page={page} totalPages={totalPages} total={total} onPageChange={onPageChange} />
    </div>
  );
}
