"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { TabBar } from "@/components/layout/tab-bar";
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
import { Pencil } from "lucide-react";
import type { ProjectRow, TaskRow } from "./page";

type ProjectFormMode = "closed" | "create" | "edit";

export function ProjectsClient({
  organizationId,
  canManage,
  projects,
  tasks,
  customers,
}: {
  organizationId: string;
  canManage: boolean;
  projects: ProjectRow[];
  tasks: TaskRow[];
  customers: { id: string; name: string | null }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [tab, setTab] = useState<"projects" | "tasks">("projects");
  const [projectFormMode, setProjectFormMode] = useState<ProjectFormMode>("closed");
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [pName, setPName] = useState("");
  const [pCustomer, setPCustomer] = useState("");
  const [tProject, setTProject] = useState(projects[0]?.id ?? "");
  const [tTitle, setTTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage || !pName.trim()) return;
    setBusy(true);
    const supabase = createClient();
    if (projectFormMode === "edit" && editingProjectId) {
      const { error } = await supabase
        .from("projects")
        .update({ name: pName.trim(), customer_id: pCustomer || null })
        .eq("id", editingProjectId);
      setBusy(false);
      if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
      toast({ title: "Project updated" });
    } else {
      const { error } = await supabase.from("projects").insert({
        organization_id: organizationId,
        name: pName.trim(),
        customer_id: pCustomer || null,
      });
      setBusy(false);
      if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
      toast({ title: "Project created" });
    }
    setPName("");
    setPCustomer("");
    setEditingProjectId(null);
    setProjectFormMode("closed");
    router.refresh();
  }

  function openEditProject(p: ProjectRow) {
    setEditingProjectId(p.id);
    setPName(p.name);
    const customer = p.customers as { id?: string } | { id?: string }[] | null;
    setPCustomer(Array.isArray(customer) ? customer[0]?.id ?? "" : customer?.id ?? "");
    setProjectFormMode("edit");
  }

  function resetProjectForm() {
    setPName("");
    setPCustomer("");
    setEditingProjectId(null);
    setProjectFormMode("closed");
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!tProject || !tTitle.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("project_tasks").insert({
      organization_id: organizationId,
      project_id: tProject,
      title: tTitle.trim(),
    });
    setBusy(false);
    if (error) return toast({ title: "Failed", description: error.message, variant: "destructive" });
    toast({ title: "Task added" });
    setTTitle("");
    router.refresh();
  }

  async function setTaskStatus(id: string, status: string) {
    const supabase = createClient();
    await supabase.from("project_tasks").update({ status }).eq("id", id);
    router.refresh();
  }

  return (
    <div className={PAGE_SHELL}>
      <PageHeader title="Project" description="Projects and tasks — Odoo Project equivalent" />
      <TabBar
        tabs={[
          { key: "projects" as const, label: "Projects" },
          { key: "tasks" as const, label: "Tasks" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {canManage && tab === "projects" && projectFormMode !== "closed" && (
        <FormCard title={projectFormMode === "edit" ? "Edit project" : "New project"} onSubmit={addProject}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={pName} onChange={(e) => setPName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Customer</Label>
              <select className={SELECT_CLS} value={pCustomer} onChange={(e) => setPCustomer(e.target.value)}>
                <option value="">None</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {projectFormMode === "edit" ? "Save changes" : "Create"}
            </Button>
            <Button type="button" variant="outline" onClick={resetProjectForm}>
              Cancel
            </Button>
          </div>
        </FormCard>
      )}

      {canManage && tab === "projects" && projectFormMode === "closed" && (
        <div className="mb-4">
          <Button onClick={() => setProjectFormMode("create")}>New project</Button>
        </div>
      )}

      {tab === "tasks" && (
        <FormCard title="New task" onSubmit={addTask}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Project</Label>
              <select className={SELECT_CLS} value={tProject} onChange={(e) => setTProject(e.target.value)}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={tTitle} onChange={(e) => setTTitle(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={busy}>Add task</Button>
        </FormCard>
      )}

      {tab === "projects" ? (
        <ResponsiveTableLayout
          mobile={
            projects.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No projects.</p>
            ) : (
              projects.map((p) => (
                <MobileRecordCard key={p.id}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <p className="font-semibold">{p.name}</p>
                    <StatusBadge status={p.is_active ? "active" : "suspended"} />
                  </div>
                  <MobileRecordCardRow label="Customer">
                    {relationName(p.customers as { name: string } | { name: string }[] | null) || "—"}
                  </MobileRecordCardRow>
                  {canManage && (
                    <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => openEditProject(p)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                </MobileRecordCard>
              ))
            )
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Project</DataTableHead>
              <DataTableHead>Customer</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              {canManage && <DataTableHead align="right">Actions</DataTableHead>}
            </DataTableHeader>
            <DataTableBody>
              {projects.length === 0 ? (
                <DataTableEmpty colSpan={canManage ? 4 : 3} message="No projects." />
              ) : (
                projects.map((p) => (
                  <DataTableRow key={p.id}>
                    <DataTableCell className="font-medium">{p.name}</DataTableCell>
                    <DataTableCell>{relationName(p.customers as { name: string } | { name: string }[] | null) || "—"}</DataTableCell>
                    <DataTableCell><StatusBadge status={p.is_active ? "active" : "suspended"} /></DataTableCell>
                    {canManage && (
                      <DataTableCell align="right">
                        <Button size="sm" variant="outline" onClick={() => openEditProject(p)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </DataTableCell>
                    )}
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </DataTable>
        </ResponsiveTableLayout>
      ) : (
        <ResponsiveTableLayout
          mobile={
            tasks.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No tasks.</p>
            ) : (
              tasks.map((t) => (
                <MobileRecordCard key={t.id}>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <p className="font-semibold">{t.title}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <MobileRecordCardRow label="Project">{relationName(t.projects)}</MobileRecordCardRow>
                  {t.status !== "done" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => setTaskStatus(t.id, t.status === "todo" ? "in_progress" : "done")}
                    >
                      {t.status === "todo" ? "Start" : "Done"}
                    </Button>
                  )}
                </MobileRecordCard>
              ))
            )
          }
        >
        <DataTable>
          <table className="w-full">
            <DataTableHeader>
              <DataTableHead>Task</DataTableHead>
              <DataTableHead>Project</DataTableHead>
              <DataTableHead>Status</DataTableHead>
              <DataTableHead align="right">Update</DataTableHead>
            </DataTableHeader>
            <DataTableBody>
              {tasks.length === 0 ? <DataTableEmpty colSpan={4} message="No tasks." /> : tasks.map((t) => (
                <DataTableRow key={t.id}>
                  <DataTableCell className="font-medium">{t.title}</DataTableCell>
                  <DataTableCell>{relationName(t.projects)}</DataTableCell>
                  <DataTableCell><StatusBadge status={t.status} /></DataTableCell>
                  <DataTableCell align="right">
                    {t.status !== "done" && (
                      <Button size="sm" variant="outline" onClick={() => setTaskStatus(t.id, t.status === "todo" ? "in_progress" : "done")}>
                        {t.status === "todo" ? "Start" : "Done"}
                      </Button>
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </table>
        </DataTable>
        </ResponsiveTableLayout>
      )}
    </div>
  );
}
