import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // platform_admins is RLS-protected: only platform admins can read it.
  const { data: adminRow } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!adminRow) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <div className="flex items-center gap-6">
            <span className="font-bold">Nexus · Super Admin</span>
            <nav className="flex gap-4 text-sm">
              <Link href="/admin" className="hover:underline">
                Organizations
              </Link>
              <Link href="/admin/import" className="hover:underline">
                Data Import
              </Link>
            </nav>
          </div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
            ← Back to app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
