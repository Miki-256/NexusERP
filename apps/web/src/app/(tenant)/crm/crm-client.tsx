"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createOpp(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Enter a title");
    setBusy(true);
    setError("");
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
    if (err) return setError(err.message);
    setTitle("");
    setValue("");
    setContactName("");
    setContactPhone("");
    setCustomerId("");
    setOpen(false);
    router.refresh();
  }

  async function moveStage(id: string, stage: Stage) {
    const supabase = createClient();
    const { error: err } = await supabase.rpc("set_opportunity_stage", {
      p_opp_id: id,
      p_stage: stage,
    });
    if (err) return alert(err.message);
    router.refresh();
  }

  const pipelineValue = opportunities
    .filter((o) => o.stage !== "lost" && o.stage !== "won")
    .reduce((s, o) => s + Number(o.expected_value), 0);
  const wonValue = opportunities
    .filter((o) => o.stage === "won")
    .reduce((s, o) => s + Number(o.expected_value), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CRM Pipeline</h1>
        <Button onClick={() => setOpen((v) => !v)}>{open ? "Close" : "New Opportunity"}</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Open Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {formatCurrency(pipelineValue, currency)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Won</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {formatCurrency(wonValue, currency)}
          </CardContent>
        </Card>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New Opportunity</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createOpp} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Expected Value</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Customer</Label>
                <select
                  className="flex h-10 w-full rounded-md border px-3 text-sm"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || "(unnamed)"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Contact Name</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </div>
              {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Create"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5 sm:grid-cols-2">
        {STAGES.map((stage) => {
          const items = opportunities.filter((o) => o.stage === stage.key);
          const total = items.reduce((s, o) => s + Number(o.expected_value), 0);
          return (
            <div key={stage.key} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-semibold">{stage.label}</span>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <p className="px-1 text-xs text-muted-foreground">
                {formatCurrency(total, currency)}
              </p>
              <div className="space-y-2">
                {items.map((o) => (
                  <Card key={o.id}>
                    <CardContent className="space-y-2 p-3">
                      <p className="font-medium leading-tight">{o.title}</p>
                      <p className="font-mono text-sm">
                        {formatCurrency(Number(o.expected_value), currency)}
                      </p>
                      {(o.contact_name || o.contact_phone) && (
                        <p className="text-xs text-muted-foreground">
                          {o.contact_name}
                          {o.contact_phone ? ` · ${o.contact_phone}` : ""}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1 pt-1">
                        {NEXT[o.stage] && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => moveStage(o.id, NEXT[o.stage]!)}
                          >
                            → {STAGES.find((s) => s.key === NEXT[o.stage])?.label}
                          </Button>
                        )}
                        {o.stage !== "won" && o.stage !== "lost" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-red-600"
                            onClick={() => moveStage(o.id, "lost")}
                          >
                            Lost
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
