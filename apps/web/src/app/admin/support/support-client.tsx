"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormCard } from "@/components/layout/form-card";
import { StatusBadge } from "@/components/layout/status-badge";
import type { TenantLookupResult } from "@/lib/admin-types";
import { AccessDebugger } from "@/app/admin/security/access-debugger";

export function SupportLookupClient({ initialEmail }: { initialEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [result, setResult] = useState<TenantLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(!!initialEmail);

  useEffect(() => {
    if (!initialEmail?.trim()) return;
    void (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("admin_lookup_by_email", {
        p_email: initialEmail.trim(),
      });
      setLoading(false);
      if (!error) setResult(data as TenantLookupResult);
      setSearched(true);
    })();
  }, [initialEmail]);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const q = email.trim();
    if (!q) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_lookup_by_email", { p_email: q });
    setLoading(false);
    if (!error) setResult(data as TenantLookupResult);
    setSearched(true);
    router.replace(`/admin/support?email=${encodeURIComponent(q)}`);
  }

  return (
    <div className="space-y-6">
      <FormCard title="Tenant lookup" description="Find a user by exact email — memberships, pending invites, and quick links.">
        <form onSubmit={lookup} className="flex gap-2">
          <Input
            type="email"
            placeholder="user@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="max-w-md"
            required
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Looking up…" : "Lookup"}
          </Button>
        </form>
      </FormCard>

      {searched && result && (
        <div className="space-y-4">
          {!result.found ? (
            <p className="text-sm text-muted-foreground">
              No account found for <strong>{result.email}</strong>. They may not have signed up yet.
            </p>
          ) : (
            <>
              <FormCard title="Account">
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="font-medium">{result.user?.email}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">User ID</dt>
                    <dd className="font-mono text-xs">{result.user?.id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Created</dt>
                    <dd>{result.user?.created_at ? new Date(result.user.created_at).toLocaleString() : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last sign-in</dt>
                    <dd>
                      {result.user?.last_sign_in_at
                        ? new Date(result.user.last_sign_in_at).toLocaleString()
                        : "Never"}
                    </dd>
                  </div>
                </dl>
                {result.user && (
                  <Button size="sm" variant="outline" className="mt-4" asChild>
                    <Link href={`/admin/users/${result.user.id}`}>Full profile</Link>
                  </Button>
                )}
              </FormCard>

              <FormCard title="Organizations">
                {result.memberships.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not a member of any organization.</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {result.memberships.map((m) => (
                      <li key={m.member_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                        <div>
                          <Link href={`/admin/organizations/${m.organization_id}`} className="font-medium hover:underline">
                            {m.organization_name}
                          </Link>
                          <span className="ml-2 capitalize text-muted-foreground">{m.role}</span>
                        </div>
                        <StatusBadge status={m.organization_status} />
                      </li>
                    ))}
                  </ul>
                )}
              </FormCard>

              {result.pending_invites.length > 0 && (
                <FormCard title="Pending invites">
                  <ul className="divide-y rounded-lg border">
                    {result.pending_invites.map((inv) => (
                      <li key={inv.invite_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                        <span>{inv.organization_name}</span>
                        <span className="capitalize text-muted-foreground">{inv.role}</span>
                      </li>
                    ))}
                  </ul>
                </FormCard>
              )}

              {result.user && (
                <AccessDebugger
                  userId={result.user.id}
                  organizationId={result.memberships[0]?.organization_id ?? null}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
