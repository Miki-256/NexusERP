import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "product-images";

export async function uploadProductImage(
  supabase: SupabaseClient,
  organizationId: string,
  productId: string,
  file: File
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${organizationId}/${productId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: true,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function removeProductImage(
  supabase: SupabaseClient,
  imageUrl: string
): Promise<void> {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = imageUrl.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(imageUrl.slice(idx + marker.length));
  await supabase.storage.from(BUCKET).remove([path]);
}
