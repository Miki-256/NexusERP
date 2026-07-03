import { NextResponse } from "next/server";
import { signupSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrConfirmUser } from "@/lib/admin-auth-users";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";

/** New ERP signup — email pre-confirmed; shop approval is handled after onboarding. */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = await rateLimitDistributed(`signup:${ip}`, 5, 60 * 60 * 1000);
  if (!limited.ok) {
    return rateLimitResponse(limited.retryAfterSec);
  }

  const parsed = await parseJsonBody(request, signupSchema);
  if (!parsed.ok) return parsed.response;

  const { email: rawEmail, password, fullName: rawFullName } = parsed.data;
  const email = rawEmail.trim().toLowerCase();
  const fullName = rawFullName.trim();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      {
        error:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to apps/web/.env.local and restart.",
      },
      { status: 500 }
    );
  }

  const { data: maintenanceRaw } = await admin.rpc("get_platform_maintenance_status");
  const maintenance = maintenanceRaw as { enabled?: boolean; block_signup?: boolean } | null;
  if (maintenance?.enabled && maintenance.block_signup) {
    return NextResponse.json({ error: "New signups are temporarily disabled." }, { status: 503 });
  }

  try {
    const result = await createOrConfirmUser(admin, { email, password, fullName });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create account";
    const status = message.includes("exists") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
