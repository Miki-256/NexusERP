import { NextResponse } from "next/server";
import { inviteSignupSchema } from "@nex/shared";
import { parseJsonBody } from "@/lib/api/parse-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOrConfirmUser } from "@/lib/admin-auth-users";
import { clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { rateLimitDistributed } from "@/lib/rate-limit-distributed";

/** Create or confirm an invited ERP user without waiting for Supabase confirmation email. */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const ipLimited = await rateLimitDistributed(`invite-signup:ip:${ip}`, 10, 60 * 60 * 1000);
  if (!ipLimited.ok) {
    return rateLimitResponse(ipLimited.retryAfterSec);
  }

  const parsed = await parseJsonBody(request, inviteSignupSchema);
  if (!parsed.ok) return parsed.response;

  const { inviteId: rawInviteId, email: rawEmail, password, fullName: rawFullName } = parsed.data;
  const inviteId = rawInviteId.trim();
  const email = rawEmail.trim().toLowerCase();
  const fullName = rawFullName.trim();

  const emailLimited = await rateLimitDistributed(`invite-signup:email:${email}`, 5, 60 * 60 * 1000);
  if (!emailLimited.ok) {
    return rateLimitResponse(emailLimited.retryAfterSec);
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      {
        error:
          "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to apps/web/.env.local and restart the dev server.",
      },
      { status: 500 }
    );
  }

  const { data: invite, error: inviteError } = await admin
    .from("staff_invites")
    .select("id, email, accepted_at")
    .eq("id", inviteId)
    .is("accepted_at", null)
    .maybeSingle();

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 500 });
  }
  if (!invite) {
    return NextResponse.json({ error: "Invite not found or already accepted" }, { status: 404 });
  }
  if (invite.email.toLowerCase() !== email) {
    return NextResponse.json({ error: "Email does not match this invite" }, { status: 400 });
  }

  try {
    const result = await createOrConfirmUser(admin, { email, password, fullName });
    return NextResponse.json({ ok: true, userId: result.userId, existing: result.existing });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create account";
    const status = message.includes("exists") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
