"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { posProductImageSources } from "@/lib/pos/product-image-urls";

export const PosProductImage = memo(function PosProductImage({
  imageUrl,
  alt,
  compact = false,
  className,
}: {
  imageUrl: string;
  alt: string;
  compact?: boolean;
  className?: string;
}) {
  const { src, srcSet, sizes } = posProductImageSources(imageUrl, { compact });

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      className={cn("h-full w-full object-cover", className)}
      loading="lazy"
      decoding="async"
      fetchPriority="low"
    />
  );
});
