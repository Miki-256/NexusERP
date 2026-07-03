import { Suspense } from "react";
import { CustomerDisplayClient } from "./customer-display-client";

export default function CustomerDisplayPage() {
  return (
    <div className="h-full min-h-0">
      <Suspense fallback={<div className="h-full bg-slate-900" />}>
        <CustomerDisplayClient />
      </Suspense>
    </div>
  );
}
