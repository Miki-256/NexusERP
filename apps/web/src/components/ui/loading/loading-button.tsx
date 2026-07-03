"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading/loading-spinner";
import { cn } from "@/lib/utils";

export function LoadingButton({
  loading,
  loadingLabel,
  children,
  disabled,
  className,
  ...props
}: ButtonProps & {
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <Button
      disabled={disabled || loading}
      aria-busy={loading}
      className={cn(loading && "cursor-wait", className)}
      {...props}
    >
      {loading ? (
        <>
          <LoadingSpinner size="sm" />
          <span>{loadingLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </Button>
  );
}
