"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { FormCard } from "@/components/layout/form-card";
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
import { SELECT_CLS } from "@/lib/ui-classes";
import { runHrMutation } from "@/lib/hr/mutations";
import type { EmploymentType, JobRequisitionRow } from "@/lib/hr/types";
import { Plus, Send, Megaphone } from "lucide-react";

export function RequisitionsTab({
  organizationId,
  canManage,
  requisitions,
  total,
  page,
  pageSize,
  orgUnits,
  onPageChange,
  onChanged,
}: {
  organizationId: string;
  canManage: boolean;
  requisitions: JobRequisitionRow[];
  total: number;
  page: number;
  pageSize: number;
  orgUnits: { id: string; name: string }[];
  onPageChange: (page: number) => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function createRequisition(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const ok = await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("upsert_job_requisition", {
          p_org_id: organizationId,
          p_title: title.trim(),
          p_department: department.trim() || null,
          p_org_unit_id: orgUnitId || null,
          p_headcount: Number(headcount) || 1,
          p_employment_type: employmentType,
          p_justification: justification.trim() || null,
        });
        return { error };
      },
      { successTitle: "Requisition created" }
    );
    setBusy(false);
    if (ok) {
      setOpen(false);
      setTitle("");
      setDepartment("");
      setJustification("");
      onChanged();
    }
  }

  async function submitRequisition(id: string) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("submit_job_requisition", { p_requisition_id: id });
        return { error };
      },
      { successTitle: "Submitted for approval" }
    );
    setBusy(false);
    onChanged();
  }

  async function approveRequisition(id: string, approved: boolean) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("approve_workflow_step", {
          p_entity_type: "job_requisition",
          p_entity_id: id,
          p_approved: approved,
        });
        return { error };
      },
      { successTitle: approved ? "Requisition approved" : "Requisition rejected" }
    );
    setBusy(false);
    onChanged();
  }

  async function publishRequisition(id: string) {
    setBusy(true);
    const supabase = createClient();
    await runHrMutation(
      router,
      toast,
      async () => {
        const { error } = await supabase.rpc("publish_job_requisition", { p_requisition_id: id });
        return { error };
      },
      { successTitle: "Job posted" }
    );
    setBusy(false);
    onChanged();
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen((v) => !v)}>
            <Plus className="h-4 w-4" />
            {open ? "Close" : "New requisition"}
          </Button>
        </div>
      )}

      {open && canManage && (
        <FormCard title="Job requisition" onSubmit={createRequisition}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Org unit</Label>
              <select className={SELECT_CLS} value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)}>
                <option value="">— None —</option>
                {orgUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Headcount</Label>
              <Input type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Employment type</Label>
              <select
                className={SELECT_CLS}
                value={employmentType}
                onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
              >
                <option value="full_time">Full time</option>
                <option value="part_time">Part time</option>
                <option value="contract">Contract</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Justification</Label>
              <Input value={justification} onChange={(e) => setJustification(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>
            Save draft
          </Button>
        </FormCard>
      )}

      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Title</DataTableHead>
            <DataTableHead>Department</DataTableHead>
            <DataTableHead>Headcount</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            {canManage && <DataTableHead align="right">Actions</DataTableHead>}
          </DataTableHeader>
          <DataTableBody>
            {requisitions.length === 0 ? (
              <DataTableEmpty colSpan={canManage ? 5 : 4} message="No requisitions yet." />
            ) : (
              requisitions.map((r) => (
                <DataTableRow key={r.id}>
                  <DataTableCell className="font-medium">{r.title}</DataTableCell>
                  <DataTableCell>{r.department ?? r.org_unit_name ?? "—"}</DataTableCell>
                  <DataTableCell>{r.headcount}</DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={r.status} />
                  </DataTableCell>
                  {canManage && (
                    <DataTableCell align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {r.status === "draft" && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void submitRequisition(r.id)}>
                            <Send className="h-3.5 w-3.5" />
                            Submit
                          </Button>
                        )}
                        {r.status === "pending_approval" && (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => void approveRequisition(r.id, true)}>
                              Approve
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void approveRequisition(r.id, false)}>
                              Reject
                            </Button>
                          </>
                        )}
                        {r.status === "approved" && (
                          <Button size="sm" disabled={busy} onClick={() => void publishRequisition(r.id)}>
                            <Megaphone className="h-3.5 w-3.5" />
                            Post job
                          </Button>
                        )}
                      </div>
                    </DataTableCell>
                  )}
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
