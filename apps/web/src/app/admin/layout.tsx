import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlatformAdminContext } from "@/lib/platform-admin";
import { AdminMobileNav, AdminSidebar } from "./admin-sidebar";

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

  const ctx = await getPlatformAdminContext();
  if (!ctx) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-card/95 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-3.5 lg:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold">Platform Admin</span>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="h-4 w-4" />
              Back to app
            </Link>
          </Button>
        </div>
        <AdminMobileNav role={ctx.role} />
      </header>
      <div className="mx-auto flex max-w-7xl">
        <AdminSidebar role={ctx.role} />
        <main className="min-w-0 flex-1 animate-fade-in p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
