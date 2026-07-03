import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/auth/sign-out-button";

export default function MaintenancePage() {
  return (
    <AuthShell
      title="Under maintenance"
      description="Nexus ERP is temporarily unavailable. Please try again later."
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Platform administrators are performing scheduled maintenance. Your data is safe.
        </p>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to login</Link>
        </Button>
        <SignOutButton className="w-full" />
      </div>
    </AuthShell>
  );
}
