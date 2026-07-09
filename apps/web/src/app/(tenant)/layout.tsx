import { Suspense } from "react";
import { TenantAuthFallback } from "@/components/layout/tenant-auth-fallback";
import { TenantLayoutAuth } from "./tenant-layout-auth";

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<TenantAuthFallback />}>
      <TenantLayoutAuth>{children}</TenantLayoutAuth>
    </Suspense>
  );
}
