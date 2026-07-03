import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { authLinkErrorMessage } from "@/lib/auth-callback-url";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(searchParams.get("next"));

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const authError = searchParams.get("error");
  if (authError) {
    const code = searchParams.get("error_code") ?? authError;
    const message = authLinkErrorMessage(code, searchParams.get("error_description"));
    return NextResponse.redirect(
      `${origin}/login?auth_error=${encodeURIComponent(code)}&auth_message=${encodeURIComponent(message)}`
    );
  }

  return NextResponse.redirect(`${origin}/login?auth_error=auth`);
}
