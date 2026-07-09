"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
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
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { relationName } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Pencil, Plus, X } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import type { TicketRow } from "./page";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export function HelpdeskClient({
  organizationId,
  tickets,
  customers,
}: {
  organizationId: string;
  tickets: TicketRow[];
  customers: { id: string; name: string | null }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("normal");
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setSubject("");
    setDescription("");
    setCustomerId("");
    setPriority("normal");
    setEditingId(null);
    setFormMode("closed");
  }

  function openEdit(ticket: TicketRow) {
    setEditingId(ticket.id);
    setSubject(ticket.subject);
    setDescription(ticket.description ?? "");
    setCustomerId(ticket.customer_id ?? "");
    setPriority(ticket.priority as (typeof PRIORITIES)[number]);
    setFormMode("edit");
  }

  async function saveTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const payload = {
      subject: subject.trim(),
      description: description || null,
      customer_id: customerId || null,
      priority,
    };

    const { error } =
      formMode === "edit" && editingId
        ? await supabase.from("helpdesk_tickets").update(payload).eq("id", editingId).eq("organization_id", organizationId)
        : await (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            return supabase.from("helpdesk_tickets").insert({
              organization_id: organizationId,
              ...payload,
              created_by: user?.id ?? null,
            });
          })();

    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: formMode === "edit" ? "Ticket updated" : "Ticket created" });
    resetForm();
    router.refresh();
  }

  async function advanceStatus(id: string, status: string) {
    const supabase = createClient();
    const patch: Record<string, unknown> = { status };
    if (status === "resolved") patch.resolved_at = new Date().toISOString();
    await supabase.from("helpdesk_tickets").update(patch).eq("id", id);
    router.refresh();
  }

  async function deleteTicket(id: string, ticketSubject: string) {
    const supabase = createClient();
    const { error } = await supabase.from("helpdesk_tickets").delete().eq("id", id).eq("organization_id", organizationId);
    if (error) return toast({ title: "Could not delete", description: deleteBlockedMessage(error), variant: "destructive" });
    toast({ title: "Ticket deleted", description: ticketSubject });
    if (editingId === id) resetForm();
    router.refresh();
  }

  const formOpen = formMode !== "closed";

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Helpdesk"
        description="Customer support tickets"
        action={
          <Button onClick={() => (formOpen ? resetForm() : setFormMode("create"))} className="cursor-pointer">
            {formOpen ? <><X className="h-4 w-4" />Close</> : <><Plus className="h-4 w-4" />New ticket</>}
          </Button>
        }
      />

      {formOpen && (
        <FormCard title={formMode === "edit" ? "Edit ticket" : "New ticket"} onSubmit={saveTicket}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Customer</Label>
              <select className={SELECT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">None</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <select className={SELECT_CLS} value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : formMode === "edit" ? "Update" : "Create ticket"}</Button>
            <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
          </div>
        </FormCard>
      )}

      <ResponsiveTableLayout
        mobile={
          tickets.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No tickets.</p>
          ) : (
            tickets.map((t) => (
              <MobileRecordCard key={t.id}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="font-semibold">{t.subject}</p>
                  <StatusBadge status={t.status} />
                </div>
                <div className="space-y-1.5">
                  <MobileRecordCardRow label="Customer">
                    {relationName(t.customers as { name: string } | { name: string }[] | null) || "—"}
                  </MobileRecordCardRow>
                  <MobileRecordCardRow label="Priority">
                    <StatusBadge status={t.priority} />
                  </MobileRecordCardRow>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <ConfirmDeleteButton
                    message="Delete this ticket permanently?"
                    onConfirm={() => deleteTicket(t.id, t.subject)}
                  />
                  {t.status === "new" && <Button size="sm" variant="outline" onClick={() => advanceStatus(t.id, "in_progress")}>Start</Button>}
                  {t.status === "in_progress" && <Button size="sm" onClick={() => advanceStatus(t.id, "resolved")}>Resolve</Button>}
                </div>
              </MobileRecordCard>
            ))
          )
        }
      >
      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Subject</DataTableHead>
            <DataTableHead>Customer</DataTableHead>
            <DataTableHead>Priority</DataTableHead>
            <DataTableHead>Status</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {tickets.length === 0 ? <DataTableEmpty colSpan={5} message="No tickets." /> : tickets.map((t) => (
              <DataTableRow key={t.id}>
                <DataTableCell className="font-medium">{t.subject}</DataTableCell>
                <DataTableCell>{relationName(t.customers as { name: string } | { name: string }[] | null) || "—"}</DataTableCell>
                <DataTableCell><StatusBadge status={t.priority} /></DataTableCell>
                <DataTableCell><StatusBadge status={t.status} /></DataTableCell>
                <DataTableCell align="right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <ConfirmDeleteButton
                      message="Delete this ticket permanently?"
                      onConfirm={() => deleteTicket(t.id, t.subject)}
                    />
                    {t.status === "new" && <Button size="sm" variant="outline" onClick={() => advanceStatus(t.id, "in_progress")}>Start</Button>}
                    {t.status === "in_progress" && <Button size="sm" onClick={() => advanceStatus(t.id, "resolved")}>Resolve</Button>}
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </table>
      </DataTable>
      </ResponsiveTableLayout>
    </div>
  );
}
