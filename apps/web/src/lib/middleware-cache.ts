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

type AccessBlockCache = { blocked: boolean; ts: number };

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
  response: NextResponse
): Promise<boolean> {
  const cached = parseAccessBlockCookie(request.cookies.get(ACCESS_BLOCK_COOKIE)?.value);
  if (cached) return cached.blocked;

  const { data: blocked } = await supabase.rpc("user_access_blocked");
  const isBlocked = blocked === true;

  response.cookies.set(
    ACCESS_BLOCK_COOKIE,
    JSON.stringify({ blocked: isBlocked, ts: Date.now() }),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 120,
    }
  );

  return isBlocked;
}
