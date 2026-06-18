"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AcceptInvitePage() {
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("id");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function accept() {
    if (!inviteId) return;
    setLoading(true);
    const supabase = createClient();
    const { error: fnError } = await supabase.rpc("accept_staff_invite", {
      p_invite_id: inviteId,
    });
    setLoading(false);
    if (fnError) {
      setError(fnError.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  useEffect(() => {
    if (inviteId) accept();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteId]);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Accept invitation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!inviteId && (
            <p className="text-sm text-muted-foreground">
              Missing invite ID in URL.
            </p>
          )}
          <Button onClick={accept} disabled={loading || !inviteId}>
            {loading ? "Accepting…" : "Accept invite"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
