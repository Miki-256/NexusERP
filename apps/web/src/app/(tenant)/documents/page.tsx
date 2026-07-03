import { requireAppAccess } from "@/lib/require-app-access";
import { createClient } from "@/lib/supabase/server";
import { DocumentsClient } from "./documents-client";

export type DocRow = {
  id: string;
  name: string;
  url: string | null;
  mime_type: string | null;
  tags: string[] | null;
  linked_type: string | null;
  created_at: string;
};

export default async function DocumentsPage() {
  const ctx = await requireAppAccess("documents");

  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, name, url, mime_type, tags, linked_type, created_at")
    .eq("organization_id", ctx.organization.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <DocumentsClient
      organizationId={ctx.organization.id}
      documents={(docs as DocRow[]) ?? []}
    />
  );
}
