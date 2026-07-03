import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Skip middleware for:
     * - POS/register kiosk (no ERP session)
     * - Public API routes (health, webhooks, auth) — must not redirect to /login
     * - Static assets
     */
    "/((?!_next/static|_next/image|favicon.ico|api/(?:dev|webhooks|health|auth|invite|v1|workspace)|pos(?:/|$)|register(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
