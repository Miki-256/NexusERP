import { NextResponse } from "next/server";
import type { z } from "zod";

export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid request body" }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message =
      parsed.error.errors.map((e) => e.message).join("; ") || "Validation failed";
    return {
      ok: false,
      response: NextResponse.json({ error: message }, { status: 400 }),
    };
  }

  return { ok: true, data: parsed.data };
}
