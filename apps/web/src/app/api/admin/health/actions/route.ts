import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runProcessQueue } from "@/lib/ops/run-process-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AdminRole = {
  is_admin?: boolean;
  can_write?: boolean;
};

async function requirePlatformWriter() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const { data: roleData } = await supabase.rpc("admin_my_role");
  const role = roleData as AdminRole | null;
  if (!role?.is_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  if (!role.can_write) {
    return {
      error: NextResponse.json(
        { error: "Write access required (super_admin or support)" },
        { status: 403 }
      ),
    } as const;
  }

  return { supabase } as const;
}

export async function POST(request: NextRequest) {
  const gate = await requirePlatformWriter();
  if ("error" in gate) return gate.error;

  let body: { action?: string; sale_id?: string; organization_id?: string; limit?: number } = {};
  try {
    body = (await request.json()) as {
      action?: string;
      sale_id?: string;
      organization_id?: string;
      limit?: number;
    };
  } catch {
    body = {};
  }

  const action = body.action ?? "drain";

  if (action === "drain") {
    try {
      const result = await runProcessQueue();
      return NextResponse.json({
        ok: result.ok,
        result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Drain failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (action === "retry_ledger") {
    const saleId = body.sale_id?.trim();
    if (!saleId) {
      return NextResponse.json({ error: "sale_id required" }, { status: 400 });
    }
    const { data, error } = await gate.supabase.rpc("admin_retry_sale_ledger_post", {
      p_sale_id: saleId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  if (action === "post_unposted") {
    const orgId = body.organization_id?.trim();
    if (!orgId) {
      return NextResponse.json({ error: "organization_id required" }, { status: 400 });
    }
    const limit = typeof body.limit === "number" ? body.limit : 100;
    const { data, error } = await gate.supabase.rpc("admin_post_unposted_sales_batch", {
      p_org_id: orgId,
      p_limit: limit,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, result: data });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
