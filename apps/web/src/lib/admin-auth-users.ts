import type { SupabaseClient } from "@supabase/supabase-js";

export async function findUserByEmail(admin: SupabaseClient, email: string) {
  const normalized = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
    if (match) return match;
    if (data.users.length < 200) break;
  }
  return null;
}

/** Create or update a user with email already confirmed (no Supabase confirmation email). */
export async function createOrConfirmUser(
  admin: SupabaseClient,
  input: { email: string; password: string; fullName: string }
) {
  const email = input.email.trim().toLowerCase();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName.trim() },
  });

  if (!createError) {
    return { userId: created.user.id, existing: false };
  }

  const alreadyExists =
    createError.message.toLowerCase().includes("already") ||
    createError.message.toLowerCase().includes("registered");

  if (!alreadyExists) {
    throw new Error(createError.message);
  }

  const existing = await findUserByEmail(admin, email);
  if (!existing) {
    throw new Error("Account exists but could not be loaded. Try signing in.");
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
    email_confirm: true,
    password: input.password,
    user_metadata: { ...existing.user_metadata, full_name: input.fullName.trim() },
  });

  if (updateError) {
    throw new Error(updateError.message);
  }

  return { userId: existing.id, existing: true };
}
