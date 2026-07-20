import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: roleData } = await supabase.rpc("admin_my_role");
  const role = roleData as { is_admin?: boolean } | null;
  if (!role?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const approvalId = request.nextUrl.searchParams.get("approval_id");

  const { data, error } = await supabase.rpc("admin_export_organization", {
    p_org_id: id,
    p_approval_id: approvalId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const orgName =
    (data as { organization?: { name?: string } })?.organization?.name?.replace(/[^\w.-]+/g, "_") ??
    id;

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="nexus-export-${orgName}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
