import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireSuperAdmin(): Promise<
  { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string } } | NextResponse
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: roleData } = await supabase.rpc("admin_my_role");
  const role = roleData as { is_admin?: boolean; can_manage_admins?: boolean } | null;
  if (!role?.is_admin || !role.can_manage_admins) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { supabase, user };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const { id: userId } = await params;
  const body = (await request.json()) as {
    action?: "disable" | "enable" | "revoke_sessions" | "reset_password";
    reason?: string;
    password?: string;
  };

  if (!body.action) {
    return NextResponse.json({ error: "action required" }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is required for security actions" },
      { status: 503 }
    );
  }

  const { supabase } = auth;

  if (body.action === "disable") {
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "876000h",
    });
    if (banError) {
      return NextResponse.json({ error: banError.message }, { status: 400 });
    }
    const { error } = await supabase.rpc("admin_set_user_disabled", {
      p_user_id: userId,
      p_disabled: true,
      p_reason: body.reason ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, action: "disabled" });
  }

  if (body.action === "enable") {
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });
    if (banError) {
      return NextResponse.json({ error: banError.message }, { status: 400 });
    }
    const { error } = await supabase.rpc("admin_set_user_disabled", {
      p_user_id: userId,
      p_disabled: false,
      p_reason: null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, action: "enabled" });
  }

  if (body.action === "revoke_sessions") {
    const { error } = await admin.auth.admin.signOut(userId, "global");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    await admin.rpc("log_security_event", {
      p_event_type: "sessions_revoked",
      p_user_id: userId,
      p_metadata: { revoked_by: auth.user.id },
    });
    return NextResponse.json({ ok: true, action: "sessions_revoked" });
  }

  if (body.action === "reset_password") {
    const password = body.password?.trim();
    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password,
    });
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    await admin.auth.admin.signOut(userId, "global");

    await admin.rpc("log_security_event", {
      p_event_type: "admin_password_reset",
      p_user_id: userId,
      p_metadata: { reset_by: auth.user.id, reason: body.reason?.trim() || null },
    });

    return NextResponse.json({ ok: true, action: "password_reset" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
