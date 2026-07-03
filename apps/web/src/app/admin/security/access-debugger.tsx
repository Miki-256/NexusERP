"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FormCard } from "@/components/layout/form-card";
import type { AccessDebugResult } from "@/lib/admin-types";

export function AccessDebugger({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId?: string | null;
}) {
  const [result, setResult] = useState<AccessDebugResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function runDebug() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_debug_user_access", {
      p_user_id: userId,
      p_organization_id: organizationId ?? undefined,
    });
    setLoading(false);
    if (!error && data) setResult(data as AccessDebugResult);
  }

  return (
    <FormCard
      title="Access debugger"
      description="Simulate why a user can or cannot access an organization."
    >
      <Button size="sm" variant="outline" onClick={runDebug} disabled={loading}>
        {loading ? "Running…" : "Run access check"}
      </Button>
      {result && (
        <div className="mt-4 space-y-3">
          <p className={`text-sm font-medium ${result.can_access ? "text-emerald-700" : "text-amber-800"}`}>
            {result.summary}
          </p>
          <ul className="divide-y rounded-lg border text-sm">
            {result.checks.map((check) => (
              <li key={check.label} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div>
                  <span className="font-medium">{check.label}</span>
                  <p className="text-xs text-muted-foreground">{check.detail}</p>
                </div>
                <span className={check.pass ? "text-emerald-600" : "text-red-600"}>
                  {check.pass ? "Pass" : "Fail"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormCard>
  );
}
