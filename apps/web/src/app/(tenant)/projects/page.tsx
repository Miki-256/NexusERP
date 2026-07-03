import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { ProjectsClient } from "./projects-client";

export type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  customers: { name: string | null } | { name: string | null }[] | null;
};

export type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  due_date: string | null;
  projects: { name: string } | { name: string }[] | null;
};

export default async function ProjectsPage() {
  const ctx = await requireAppAccess("projects");

  const supabase = await createClient();
  const orgId = ctx.organization.id;

  const [{ data: projects }, { data: tasks }, { data: customers }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, description, is_active, customers(name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false }),
    supabase
      .from("project_tasks")
      .select("id, project_id, title, status, due_date, projects(name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("customers").select("id, name").eq("organization_id", orgId).order("name"),
  ]);

  return (
    <ProjectsClient
      organizationId={orgId}
      canManage={ctx.canManageApp("projects")}
      projects={(projects as unknown as ProjectRow[]) ?? []}
      tasks={(tasks as unknown as TaskRow[]) ?? []}
      customers={(customers as { id: string; name: string | null }[]) ?? []}
    />
  );
}
