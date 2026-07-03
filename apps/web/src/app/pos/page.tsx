import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { relationName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PosKioskLanding } from "@/components/pos/pos-kiosk";

export default async function PosSelectPage() {
  const ctx = await getCurrentMembership();

  if (!ctx) {
    return <PosKioskLanding />;
  }

  const supabase = await createClient();
  const { data: registers } = await supabase
    .from("registers")
    .select("id, name, stores(name)")
    .eq("organization_id", ctx.organization.id)
    .eq("is_active", true);

  return (
    <main className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-8">
      <h1 className="text-2xl font-bold">Select register</h1>
      <p className="max-w-lg text-center text-sm text-muted-foreground">
        Share the <strong>Open register</strong> link with cashiers — they can use it without ERP login.
      </p>
      <div className="grid w-full max-w-lg gap-4">
        {(registers ?? []).map((reg) => (
          <Card key={reg.id}>
            <CardHeader>
              <CardTitle>{reg.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {relationName(reg.stores as { name: string } | { name: string }[])}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                /pos/{reg.id}
              </p>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" size="lg">
                <Link href={`/pos/${reg.id}`}>Open register</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Button asChild variant="outline">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </main>
  );
}
