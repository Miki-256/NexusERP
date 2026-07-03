import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";
import { getSupabaseKey, getSupabaseUrl } from "./env";
import { getMaintenanceStatus, getUserAccessBlocked } from "@/lib/middleware-cache";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabaseKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const pathname = request.nextUrl.pathname;
  const isApiRoute = pathname.startsWith("/api/");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthPage =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot-password");
  const isResetPassword = pathname.startsWith("/reset-password");
  const isOnboarding = pathname.startsWith("/onboarding");
  const isPendingApproval = pathname.startsWith("/pending-approval");
  const isInvite = pathname.startsWith("/invite");
  const isPosPublic =
    pathname === "/pos" ||
    pathname.startsWith("/pos/") ||
    pathname.startsWith("/register/");

  const isMaintenance = pathname.startsWith("/maintenance");
  const isAdmin = pathname.startsWith("/admin");
  const isBootstrap =
    pathname.startsWith("/api/workspace") || pathname === POST_AUTH_BOOTSTRAP_PATH;

  const isPublicApi =
    pathname.startsWith("/api/webhooks/") ||
    pathname === "/api/invite/signup" ||
    pathname === "/api/auth/signup" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/activate-unconfirmed" ||
    pathname === "/api/auth/log-failed-login" ||
    pathname === "/api/health" ||
    pathname === "/api/workspace/bootstrap" ||
    pathname.startsWith("/api/v1/catalog");

  const isPublic =
    isAuthPage ||
    isResetPassword ||
    isInvite ||
    isMaintenance ||
    pathname.startsWith("/auth") ||
    isPosPublic ||
    isPublicApi;

  // Skip maintenance RPC on most API routes (bootstrap still checks below if needed).
  const maintenance =
    isApiRoute && !isBootstrap
      ? { enabled: false, block_signup: false }
      : await getMaintenanceStatus(request, supabase, supabaseResponse);

  if (maintenance.enabled) {
    const isSignupBlocked = maintenance.block_signup && pathname.startsWith("/signup");
    const needsBypass =
      !isAdmin &&
      !isBootstrap &&
      !isMaintenance &&
      !isPublic &&
      pathname !== "/login";

    if (isSignupBlocked || (user && needsBypass)) {
      let isPlatformAdmin = false;
      if (user) {
        const { data: roleData } = await supabase.rpc("admin_my_role");
        isPlatformAdmin = !!(roleData as { is_admin?: boolean } | null)?.is_admin;
      }
      if (!isPlatformAdmin) {
        const url = request.nextUrl.clone();
        url.pathname = isSignupBlocked ? "/login" : "/maintenance";
        return NextResponse.redirect(url);
      }
    }
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage && request.method === "GET") {
    const url = request.nextUrl.clone();
    url.pathname = POST_AUTH_BOOTSTRAP_PATH;
    return NextResponse.redirect(url, 303);
  }

  if (user && isResetPassword) {
    return supabaseResponse;
  }

  if (user && (isOnboarding || isPendingApproval)) {
    return supabaseResponse;
  }

  if (user && !isAdmin && !isBootstrap && !isMaintenance && !isPublic) {
    const blocked = await getUserAccessBlocked(request, supabase, supabaseResponse);
    if (blocked) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("disabled", "1");
      return NextResponse.redirect(url);
    }
  }

  // App permissions are enforced in tenant layout + requireAppAccess (avoids 2 RPCs per navigation).

  return supabaseResponse;
}
