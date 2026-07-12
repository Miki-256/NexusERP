import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { loadWorkspaceFromRpc } from "@/lib/workspace";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`catalog:${ip}`, 60, 60 * 1000);
  if (!limited.ok) {
    return rateLimitResponse(limited.retryAfterSec);
  }

  const apiKey = request.headers.get("x-nexus-api-key");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (apiKey && url && serviceKey) {
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: orgId, error: keyError } = await admin.rpc("resolve_org_api_key", {
      p_api_key: apiKey,
    });
    if (keyError || !orgId) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }
    const { data, error } = await admin.rpc("get_org_catalog_export", {
      p_organization_id: orgId as string,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(data);
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;
  const workspace = await loadWorkspaceFromRpc(supabase, activeOrgId);
  const org = workspace?.organization;
  if (!org?.id) {
    return NextResponse.json({ error: "No organization context" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("get_org_catalog_export", {
    p_organization_id: org.id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
