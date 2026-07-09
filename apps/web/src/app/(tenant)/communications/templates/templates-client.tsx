"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { SELECT_CLS } from "@/lib/ui-classes";
import { CommunicationsSubNav } from "../communications-sub-nav";
import type { NotificationTemplateRow } from "@/lib/notifications/types";

function dedupeTemplates(rows: NotificationTemplateRow[]): NotificationTemplateRow[] {
  const byKey = new Map<string, NotificationTemplateRow>();
  for (const row of rows) {
    const key = `${row.code}:${row.channel}`;
    const existing = byKey.get(key);
    if (!existing || (row.organization_id && !existing.organization_id)) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()];
}

export function TemplatesClient({
  orgId,
  templates: initial,
}: {
  orgId: string;
  templates: NotificationTemplateRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = useState(() => dedupeTemplates(initial));
  const [editing, setEditing] = useState<NotificationTemplateRow | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [bodyFormat, setBodyFormat] = useState<"html" | "plain">("html");
  const [saving, setSaving] = useState(false);

  function startEdit(row: NotificationTemplateRow) {
    if (row.is_system) {
      setEditing({ ...row, organization_id: orgId, is_system: false });
      setName(row.name);
      setSubject(row.subject_template ?? "");
      setBody(row.body_template);
      setBodyFormat(row.body_format === "plain" ? "plain" : "html");
      return;
    }
    setEditing(row);
    setName(row.name);
    setSubject(row.subject_template ?? "");
    setBody(row.body_template);
    setBodyFormat(row.body_format === "plain" ? "plain" : "html");
  }

  async function saveOverride(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_notification_template", {
      p_org_id: orgId,
      p_code: editing.code,
      p_channel: editing.channel,
      p_name: name.trim(),
      p_subject_template: subject,
      p_body_template: body,
      p_body_format: bodyFormat,
      p_is_active: true,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Template saved", description: "Org override will be used for new deliveries." });
    const { data } = await supabase.rpc("list_notification_templates", { p_org_id: orgId });
    setTemplates(dedupeTemplates((data as NotificationTemplateRow[]) ?? []));
    setEditing(null);
    router.refresh();
  }

  const emailTemplates = templates.filter((t) => t.channel === "email");

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Email templates"
        description="Customize subject and body for team invites and invoice reminders. Use {{placeholders}} for dynamic fields."
      />
      <CommunicationsSubNav active="/communications/templates" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {emailTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No email templates found. Apply migration 00080.</p>
            ) : (
              emailTemplates.map((t) => (
                <div
                  key={`${t.code}-${t.channel}-${t.organization_id ?? "system"}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
                >
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{t.code}</p>
                    <div className="mt-1 flex gap-2">
                      {t.is_system ? (
                        <Badge variant="secondary">System default</Badge>
                      ) : (
                        <Badge>Org override</Badge>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                    {t.is_system ? "Customize" : "Edit"}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editing ? `Edit — ${editing.code}` : "Select a template"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <form onSubmit={saveOverride} className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <select
                    className={SELECT_CLS}
                    value={bodyFormat}
                    onChange={(e) => setBodyFormat(e.target.value as "html" | "plain")}
                  >
                    <option value="html">HTML</option>
                    <option value="plain">Plain text</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Body</Label>
                  <textarea
                    className="min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Invite: {"{{org_name}}"}, {"{{inviter_name}}"}, {"{{role}}"}, {"{{invite_url}}"} — Invoice:{" "}
                  {"{{invoice_no}}"}, {"{{customer_name}}"}, {"{{total}}"}, {"{{due_date}}"}, {"{{days_overdue}}"}
                </p>
                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving…" : "Save org override"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Choose a template to create an organization-specific override. System defaults remain if you do not
                customize.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
