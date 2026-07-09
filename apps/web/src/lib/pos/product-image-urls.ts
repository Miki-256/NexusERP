const BUCKET = "product-images";
const OBJECT_PREFIX = `/storage/v1/object/public/${BUCKET}/`;
const RENDER_PREFIX = `/storage/v1/render/image/public/${BUCKET}/`;

const POS_COMPACT_WIDTHS = [120, 200, 280] as const;
const POS_COMFORTABLE_WIDTHS = [160, 320, 480] as const;

function isSupabaseProductImage(imageUrl: string): boolean {
  return imageUrl.includes(OBJECT_PREFIX) || imageUrl.includes(RENDER_PREFIX);
}

/** Supabase Storage image transform URL for POS catalog tiles. */
export function posProductImageUrl(imageUrl: string, width: number, quality = 72): string {
  if (!isSupabaseProductImage(imageUrl)) return imageUrl;

  try {
    const url = new URL(imageUrl);
    url.pathname = url.pathname.replace(OBJECT_PREFIX, RENDER_PREFIX);
    url.searchParams.set("width", String(width));
    url.searchParams.set("resize", "cover");
    url.searchParams.set("quality", String(quality));
    return url.toString();
  } catch {
    return imageUrl;
  }
}

export type PosProductImageSources = {
  src: string;
  srcSet?: string;
  sizes?: string;
};

/** Responsive src/srcSet for virtualized POS product cards. */
export function posProductImageSources(
  imageUrl: string,
  options: { compact?: boolean } = {}
): PosProductImageSources {
  if (!imageUrl || !isSupabaseProductImage(imageUrl)) {
    return { src: imageUrl };
  }

  const widths = options.compact ? POS_COMPACT_WIDTHS : POS_COMFORTABLE_WIDTHS;
  const defaultWidth = widths[Math.min(1, widths.length - 1)];
  const src = posProductImageUrl(imageUrl, defaultWidth);
  const srcSet = widths.map((w) => `${posProductImageUrl(imageUrl, w)} ${w}w`).join(", ");
  const sizes = options.compact
    ? "(max-width: 480px) 45vw, (max-width: 1024px) 22vw, 180px"
    : "(max-width: 480px) 45vw, (max-width: 1024px) 28vw, 280px";

  return { src, srcSet, sizes };
}
