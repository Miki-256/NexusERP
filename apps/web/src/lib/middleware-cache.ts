import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const MAINT_COOKIE = "nx_maint_v1";
const MAINT_TTL_MS = 120_000;
const ACCESS_BLOCK_COOKIE = "nx_access_v1";
const ACCESS_BLOCK_TTL_MS = 120_000;

type MaintenanceStatus = {
  enabled?: boolean;
  block_signup?: boolean;
};

type CachedMaintenance = MaintenanceStatus & { ts: number };

function parseMaintCookie(raw: string | undefined): CachedMaintenance | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedMaintenance;
    if (typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > MAINT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getMaintenanceStatus(
  request: NextRequest,
  supabase: SupabaseClient,
  response: NextResponse
): Promise<MaintenanceStatus> {
  const cached = parseMaintCookie(request.cookies.get(MAINT_COOKIE)?.value);
  if (cached) {
    return { enabled: cached.enabled, block_signup: cached.block_signup };
  }

  const { data: maintenanceRaw } = await supabase.rpc("get_platform_maintenance_status");
  const maintenance = (maintenanceRaw ?? { enabled: false }) as MaintenanceStatus;

  response.cookies.set(
    MAINT_COOKIE,
    JSON.stringify({
      enabled: !!maintenance.enabled,
      block_signup: !!maintenance.block_signup,
      ts: Date.now(),
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60,
    }
  );

  return maintenance;
}

type AccessBlockCache = { blocked: boolean; ts: number; userId?: string };

function parseAccessBlockCookie(raw: string | undefined): AccessBlockCache | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AccessBlockCache;
    if (typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > ACCESS_BLOCK_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Cached user_access_blocked check — avoids an RPC on every navigation. */
export async function getUserAccessBlocked(
  request: NextRequest,
  supabase: SupabaseClient,
  response: NextResponse,
  userId: string
): Promise<boolean> {
  const cached = parseAccessBlockCookie(request.cookies.get(ACCESS_BLOCK_COOKIE)?.value);
  // Must be scoped to the signed-in user — a prior blocked session must not lock out the next login.
  if (cached && cached.userId === userId) return cached.blocked;

  const { data: blocked, error } = await supabase.rpc("user_access_blocked");
  // Fail open on RPC errors — a false "blocked" signs the user out and looks like a login loop.
  const isBlocked = !error && blocked === true;

  response.cookies.set(
    ACCESS_BLOCK_COOKIE,
    JSON.stringify({ blocked: isBlocked, ts: Date.now(), userId }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.VERCEL === "1" || process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 120,
    }
  );

  return isBlocked;
}
