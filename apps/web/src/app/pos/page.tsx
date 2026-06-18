import { getCurrentMembership } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { relationName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PosSelectPage() {
  const ctx = await getCurrentMembership();
  if (!ctx) redirect("/onboarding");

  const supabase = await createClient();
  const { data: registers } = await supabase
    .from("registers")
    .select("id, name, stores(name)")
    .eq("organization_id", ctx.organization.id)
    .eq("is_active", true);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Select register</h1>
      <div className="grid w-full max-w-lg gap-4">
        {(registers ?? []).map((reg) => (
          <Card key={reg.id}>
            <CardHeader>
              <CardTitle>{reg.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {relationName(reg.stores as { name: string } | { name: string }[])}
              </p>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" size="lg">
                <Link href={`/pos/${reg.id}`}>Open</Link>
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
