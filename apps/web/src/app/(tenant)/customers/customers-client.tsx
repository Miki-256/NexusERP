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
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from "@/components/layout/data-table";
import { formatCurrency } from "@/lib/utils";
import { PAGE_SHELL } from "@/lib/ui-classes";
import { Pencil, Plus, User, X } from "lucide-react";
import { TableToolbar, TablePagination } from "@/components/layout/table-toolbar";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import { CustomerPurchasePanel } from "@/components/sales/customer-purchase-panel";
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import type { ContactSummary, CustomerRecord } from "./page";

type FormMode = "closed" | "create" | "edit";

export function CustomersClient({
  organizationId,
  currency,
  contacts,
  customers,
  total,
  page,
  pageSize,
  searchQuery,
  canManageCreditTerms,
}: {
  organizationId: string;
  currency: string;
  contacts: ContactSummary[];
  customers: CustomerRecord[];
  total: number;
  page: number;
  pageSize: number;
  searchQuery: string;
  canManageCreditTerms: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<FormMode>("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [onAccountEnabled, setOnAccountEnabled] = useState(false);
  const [creditLimit, setCreditLimit] = useState("");
  const [busy, setBusy] = useState(false);

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function navigateList(nextPage: number, q: string) {
    const params = new URLSearchParams();
    const trimmed = q.trim();
    if (trimmed) params.set("q", trimmed);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.push(qs ? `/customers?${qs}` : "/customers");
  }

  function submitSearch() {
    navigateList(1, searchInput);
  }

  function resetForm() {
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setNotes("");
    setOnAccountEnabled(false);
    setCreditLimit("");
    setEditingId(null);
    setFormMode("closed");
  }

  function openCreate() {
    resetForm();
    setFormMode("create");
  }

  function openEdit(record: CustomerRecord) {
    setEditingId(record.id);
    setName(record.name ?? "");
    setPhone(record.phone ?? "");
    setEmail(record.email ?? "");
    setAddress(record.address ?? "");
    setNotes(record.notes ?? "");
    setOnAccountEnabled(Boolean(record.on_account_enabled));
    setCreditLimit(record.credit_limit != null ? String(record.credit_limit) : "");
    setFormMode("edit");
  }

  async function saveContact(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() && !phone.trim()) {
      return toast({ title: "Missing info", description: "Enter a name or phone.", variant: "destructive" });
    }
    setBusy(true);
    const supabase = createClient();
    const contactPayload = {
      name: name.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    };

    let customerId = editingId;

    if (formMode === "edit" && editingId) {
      const { error: err } = await supabase
        .from("customers")
        .update(contactPayload)
        .eq("id", editingId)
        .eq("organization_id", organizationId);
      if (err) {
        setBusy(false);
        return toast({ title: "Could not save", description: err.message, variant: "destructive" });
      }
    } else {
      const { data: inserted, error: err } = await supabase
        .from("customers")
        .insert({ organization_id: organizationId, ...contactPayload })
        .select("id")
        .single();
      if (err || !inserted) {
        setBusy(false);
        return toast({
          title: "Could not save",
          description: err?.message ?? "Could not create customer",
          variant: "destructive",
        });
      }
      customerId = inserted.id;
    }

    if (canManageCreditTerms && customerId) {
      const { error: termsError } = await supabase.rpc("update_customer_account_terms", {
        p_org_id: organizationId,
        p_customer_id: customerId,
        p_on_account_enabled: onAccountEnabled,
        p_credit_limit: creditLimit.trim() ? Number(creditLimit) : null,
      });
      if (termsError) {
        setBusy(false);
        return toast({ title: "Could not save credit terms", description: termsError.message, variant: "destructive" });
      }
    }

    setBusy(false);
    toast({
      title: formMode === "edit" ? "Customer updated" : "Customer added",
      description: name || phone,
    });
    resetForm();
    router.refresh();
  }

  async function deleteCustomer(id: string, displayName: string, orderCount: number) {
    const supabase = createClient();
    const { error } = await supabase.from("customers").delete().eq("id", id).eq("organization_id", organizationId);
    if (error) {
      return toast({
        title: "Could not delete customer",
        description: deleteBlockedMessage(error),
        variant: "destructive",
      });
    }
    toast({
      title: "Customer deleted",
      description: orderCount > 0 ? `${displayName} removed. Past sales remain on record.` : displayName,
    });
    if (editingId === id) resetForm();
    router.refresh();
  }

  const formOpen = formMode !== "closed";

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Customers"
        description={`${contacts.length} contact${contacts.length === 1 ? "" : "s"} · track lifetime spend and orders`}
        action={
          <Button onClick={() => (formOpen ? resetForm() : openCreate())} className="shadow-sm cursor-pointer">
            {formOpen ? (
              <>
                <X className="h-4 w-4" />
                Close
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Customer
              </>
            )}
          </Button>
        }
      />

      {formOpen && (
        <FormCard title={formMode === "edit" ? "Edit Customer" : "New Customer"}>
          <form onSubmit={saveContact} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-3">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {canManageCreditTerms && (
              <>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <input
                    id="on-account"
                    type="checkbox"
                    checked={onAccountEnabled}
                    onChange={(e) => setOnAccountEnabled(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-input"
                  />
                  <Label htmlFor="on-account" className="cursor-pointer">
                    Enable pay later
                  </Label>
                </div>
                <div className="space-y-2">
                  <Label>Credit limit ({currency})</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    placeholder="Optional"
                    disabled={!onAccountEnabled}
                  />
                </div>
              </>
            )}
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" disabled={busy} className="cursor-pointer">
                {busy ? "Saving…" : formMode === "edit" ? "Update" : "Save"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="cursor-pointer">
                Cancel
              </Button>
            </div>
          </form>
        </FormCard>
      )}

      <div className="mb-4 lg:hidden">
        <TableToolbar
          search={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={submitSearch}
          placeholder="Search name, phone, email…"
        />
      </div>

      <div className="space-y-3 lg:hidden">
        {contacts.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No customers found.</p>
        ) : (
          contacts.map((c) => {
            const record = customerById.get(c.customer_id);
            return (
              <MobileRecordCard key={c.customer_id}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name || "—"}</p>
                    <CustomerPurchasePanel customerId={c.customer_id} currency={currency} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <MobileRecordCardRow label="Phone">{c.phone || "—"}</MobileRecordCardRow>
                  <MobileRecordCardRow label="Email">{c.email || "—"}</MobileRecordCardRow>
                  <MobileRecordCardRow label="Orders">{c.order_count}</MobileRecordCardRow>
                  <MobileRecordCardRow label="Spend">
                    {formatCurrency(Number(c.total_spent), currency)}
                  </MobileRecordCardRow>
                  <MobileRecordCardRow label="Last order">
                    {c.last_order ? new Date(c.last_order).toLocaleDateString() : "—"}
                  </MobileRecordCardRow>
                </div>
                {record && (
                  <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
                    <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(record)}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <ConfirmDeleteButton
                      message={
                        c.order_count > 0
                          ? "Has sales history. Delete only if you are sure."
                          : "Remove this customer permanently?"
                      }
                      onConfirm={() => deleteCustomer(record.id, record.name ?? "Customer", c.order_count)}
                    />
                  </div>
                )}
              </MobileRecordCard>
            );
          })
        )}
      </div>

      <div className="hidden lg:block">
      <DataTable
        toolbar={
          <TableToolbar
            search={searchInput}
            onSearchChange={setSearchInput}
            onSearchSubmit={submitSearch}
            placeholder="Search name, phone, email…"
          />
        }
      >
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Customer</DataTableHead>
            <DataTableHead>Phone</DataTableHead>
            <DataTableHead>Email</DataTableHead>
            <DataTableHead align="right">Orders</DataTableHead>
            <DataTableHead align="right">Lifetime Spend</DataTableHead>
            <DataTableHead>Last Order</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {contacts.length === 0 ? (
              <DataTableEmpty colSpan={7} message="No customers found." />
            ) : (
              contacts.map((c) => {
                const record = customerById.get(c.customer_id);
                return (
                  <DataTableRow key={c.customer_id}>
                    <DataTableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <User className="h-4 w-4" />
                        </div>
                        <div>
                          <span className="font-medium">{c.name || "—"}</span>
                          <CustomerPurchasePanel customerId={c.customer_id} currency={currency} />
                        </div>
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">{c.phone || "—"}</DataTableCell>
                    <DataTableCell className="text-muted-foreground">{c.email || "—"}</DataTableCell>
                    <DataTableCell align="right">{c.order_count}</DataTableCell>
                    <DataTableCell align="right" className="font-mono font-medium">
                      {formatCurrency(Number(c.total_spent), currency)}
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {c.last_order ? new Date(c.last_order).toLocaleDateString() : "—"}
                    </DataTableCell>
                    <DataTableCell align="right">
                      {record ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="cursor-pointer"
                            onClick={() => openEdit(record)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <ConfirmDeleteButton
                            message={
                              c.order_count > 0
                                ? "Has sales history. Delete only if you are sure."
                                : "Remove this customer permanently?"
                            }
                            onConfirm={() => deleteCustomer(record.id, record.name ?? "Customer", c.order_count)}
                          />
                        </div>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                );
              })
            )}
          </DataTableBody>
        </table>
      </DataTable>
      {total > pageSize && (
        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPageChange={(p) => navigateList(p, searchQuery)}
        />
      )}
      </div>
    </div>
  );
}
