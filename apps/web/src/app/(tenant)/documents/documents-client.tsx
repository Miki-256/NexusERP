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
import { MobileRecordCard, MobileRecordCardRow } from "@/components/layout/mobile-record-card";
import { ResponsiveTableLayout } from "@/components/layout/responsive-table-layout";
import { PAGE_SHELL } from "@/lib/ui-classes";
import { Pencil, Plus, X } from "lucide-react";
import { ConfirmDeleteButton } from "@/components/layout/confirm-delete-button";
import { deleteBlockedMessage } from "@/lib/delete-errors";
import type { DocRow } from "./page";

export function DocumentsClient({
  organizationId,
  documents,
}: {
  organizationId: string;
  documents: DocRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [formMode, setFormMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setName("");
    setUrl("");
    setTags("");
    setEditingId(null);
    setFormMode("closed");
  }

  function openEdit(doc: DocRow) {
    setEditingId(doc.id);
    setName(doc.name);
    setUrl(doc.url ?? "");
    setTags(Array.isArray(doc.tags) ? doc.tags.join(", ") : "");
    setFormMode("edit");
  }

  async function saveDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const payload = {
      name: name.trim(),
      url: url || null,
      tags: tagList.length ? tagList : null,
    };

    const { error } =
      formMode === "edit" && editingId
        ? await supabase.from("documents").update(payload).eq("id", editingId).eq("organization_id", organizationId)
        : await (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            return supabase.from("documents").insert({
              organization_id: organizationId,
              ...payload,
              uploaded_by: user?.id ?? null,
            });
          })();

    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: formMode === "edit" ? "Document updated" : "Document added" });
    resetForm();
    router.refresh();
  }

  async function deleteDoc(id: string, docName: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("documents").delete().eq("id", id).eq("organization_id", organizationId);
    setBusy(false);
    if (error) return toast({ title: "Could not delete", description: deleteBlockedMessage(error), variant: "destructive" });
    toast({ title: "Document deleted", description: docName });
    if (editingId === id) resetForm();
    router.refresh();
  }

  const formOpen = formMode !== "closed";

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="Documents"
        description="File links and metadata — Odoo Documents (lightweight)"
        action={
          <Button onClick={() => (formOpen ? resetForm() : setFormMode("create"))} className="cursor-pointer">
            {formOpen ? <><X className="h-4 w-4" />Close</> : <><Plus className="h-4 w-4" />Add document</>}
          </Button>
        }
      />

      {formOpen && (
        <FormCard title={formMode === "edit" ? "Edit document" : "Register document"} onSubmit={saveDoc}>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>URL</Label>
              <Input placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button type="submit" disabled={busy} className="cursor-pointer">
              {busy ? "Saving…" : formMode === "edit" ? "Update" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={resetForm} className="cursor-pointer">Cancel</Button>
          </div>
        </FormCard>
      )}

      <ResponsiveTableLayout
        mobile={
          documents.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No documents.</p>
          ) : (
            documents.map((d) => (
              <MobileRecordCard key={d.id}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <p className="font-semibold">{d.name}</p>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0 text-sm text-primary hover:underline">
                      Open
                    </a>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <MobileRecordCardRow label="Added">{new Date(d.created_at).toLocaleDateString()}</MobileRecordCardRow>
                  {Array.isArray(d.tags) && d.tags.length > 0 && (
                    <MobileRecordCardRow label="Tags">{d.tags.join(", ")}</MobileRecordCardRow>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(d)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <ConfirmDeleteButton
                    message="Remove this document link permanently?"
                    onConfirm={() => deleteDoc(d.id, d.name)}
                  />
                </div>
              </MobileRecordCard>
            ))
          )
        }
      >
      <DataTable>
        <table className="w-full">
          <DataTableHeader>
            <DataTableHead>Name</DataTableHead>
            <DataTableHead>Link</DataTableHead>
            <DataTableHead>Tags</DataTableHead>
            <DataTableHead>Added</DataTableHead>
            <DataTableHead align="right">Actions</DataTableHead>
          </DataTableHeader>
          <DataTableBody>
            {documents.length === 0 ? (
              <DataTableEmpty colSpan={5} message="No documents." />
            ) : (
              documents.map((d) => (
                <DataTableRow key={d.id}>
                  <DataTableCell className="font-medium">{d.name}</DataTableCell>
                  <DataTableCell>
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Open
                      </a>
                    ) : (
                      "—"
                    )}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {Array.isArray(d.tags) ? d.tags.join(", ") : "—"}
                  </DataTableCell>
                  <DataTableCell className="text-muted-foreground">
                    {new Date(d.created_at).toLocaleDateString()}
                  </DataTableCell>
                  <DataTableCell align="right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => openEdit(d)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <ConfirmDeleteButton
                        message="Remove this document link permanently?"
                        onConfirm={() => deleteDoc(d.id, d.name)}
                      />
                    </div>
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </table>
      </DataTable>
      </ResponsiveTableLayout>
    </div>
  );
}
