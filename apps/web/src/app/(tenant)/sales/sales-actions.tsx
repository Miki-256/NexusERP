"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SalesActions({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function voidSale() {
    const reason = prompt("Reason for void:");
    if (!reason) return;
    setLoading(true);
    const supabase = createClient();
    await supabase.rpc("void_sale", { p_sale_id: saleId, p_reason: reason });
    setLoading(false);
    router.refresh();
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={voidSale}
      disabled={loading}
    >
      Void
    </Button>
  );
}
