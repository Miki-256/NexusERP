"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { FormCard } from "@/components/layout/form-card";
import { StatCard } from "@/components/layout/stat-card";
import { formatCurrency } from "@/lib/utils";
import { PAGE_SHELL, SELECT_CLS } from "@/lib/ui-classes";
import { Plus, Target, Trophy } from "lucide-react";
import type { Opportunity } from "./page";

type Stage = Opportunity["stage"];

const STAGES: { key: Stage; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "qualified", label: "Qualified" },
  { key: "proposal", label: "Proposal" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

const NEXT: Partial<Record<Stage, Stage>> = {
  lead: "qualified",
  qualified: "proposal",
  proposal: "won",
};

export function CrmClient({
  organizationId,
  currency,
  opportunities,
  customers,
}: {
  organizationId: string;
  currency: string;
  opportunities: Opportunity[];
  customers: { id: string; name: string | null }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);

  async function createOpp(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return toast({ title: "Title required", variant: "destructive" });
    setBusy(true);
    const supabase = createClient();
    const { error: err } = await supabase.from("opportunities").insert({
      organization_id: organizationId,
      title: title.trim(),
      expected_value: Number(value) || 0,
      contact_name: contactName.trim() || null,
      contact_phone: contactPhone.trim() || null,
      customer_id: customerId || null,
      stage: "lead",
    });
    setBusy(false);
    if (err) return toast({ title: "Could not create", description: err.message, variant: "destructive" });
    toast({ title: "Opportunity created", description: title });
    setTitle(""); setValue(""); setContactName(""); setContactPhone(""); setCustomerId("");
    setOpen(false);
    router.refresh();
  }

  async function moveStage(id: string, stage: Stage) {
    const supabase = createClient();
    const { error: err } = await supabase.rpc("set_opportunity_stage", { p_opp_id: id, p_stage: stage });
    if (err) return toast({ title: "Update failed", description: err.message, variant: "destructive" });
    router.refresh();
  }

  const pipelineValue = opportunities.filter((o) => o.stage !== "lost" && o.stage !== "won").reduce((s, o) => s + Number(o.expected_value), 0);
  const wonValue = opportunities.filter((o) => o.stage === "won").reduce((s, o) => s + Number(o.expected_value), 0);

  return (
    <div className={PAGE_SHELL}>
      <PageHeader
        title="CRM Pipeline"
        description="Track deals from lead to close"
        action={
          <Button onClick={() => setOpen((v) => !v)} className="shadow-sm">
            {open ? "Close" : (<><Plus className="h-4 w-4" />New Opportunity</>)}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Open Pipeline" value={formatCurrency(pipelineValue, currency)} icon={Target} />
        <StatCard label="Won" value={formatCurrency(wonValue, currency)} icon={Trophy} highlight="positive" />
      </div>

      {open && (
        <FormCard title="New Opportunity">
          <form onSubmit={createOpp} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="space-y-2"><Label>Expected Value</Label><Input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></div>
            <div className="space-y-2"><Label>Customer</Label><select className={SELECT_CLS} value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">— None —</option>{customers.map((c) => (<option key={c.id} value={c.id}>{c.name || "(unnamed)"}</option>))}</select></div>
            <div className="space-y-2"><Label>Contact Name</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
            <div className="space-y-2"><Label>Contact Phone</Label><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></div>
            <div><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create"}</Button></div>
          </form>
        </FormCard>
      )}

      <div className="grid gap-4 lg:grid-cols-5 sm:grid-cols-2">
        {STAGES.map((stage) => {
          const items = opportunities.filter((o) => o.stage === stage.key);
          const total = items.reduce((s, o) => s + Number(o.expected_value), 0);
          return (
            <div key={stage.key} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">{stage.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
              </div>
              <p className="mb-3 text-xs font-medium text-muted-foreground">{formatCurrency(total, currency)}</p>
              <div className="space-y-2">
                {items.map((o) => (
                  <div key={o.id} className="rounded-lg border bg-background p-3 transition-shadow hover:shadow-sm">
                    <p className="font-medium leading-tight">{o.title}</p>
                    <p className="mt-1 font-mono text-sm">{formatCurrency(Number(o.expected_value), currency)}</p>
                    {(o.contact_name || o.contact_phone) && (
                      <p className="mt-1 text-xs text-muted-foreground">{o.contact_name}{o.contact_phone ? ` · ${o.contact_phone}` : ""}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {NEXT[o.stage] && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => moveStage(o.id, NEXT[o.stage]!)}>
                          → {STAGES.find((s) => s.key === NEXT[o.stage])?.label}
                        </Button>
                      )}
                      {o.stage !== "won" && o.stage !== "lost" && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-600" onClick={() => moveStage(o.id, "lost")}>Lost</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
