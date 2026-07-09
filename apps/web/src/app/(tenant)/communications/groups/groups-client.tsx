"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { CommunicationsSubNav } from "../communications-sub-nav";
import type { NotificationRecipientGroupRow } from "@/lib/notifications/types";

function parseEmails(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function GroupsClient({
  orgId,
  groups: initial,
}: {
  orgId: string;
  groups: NotificationRecipientGroupRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [groups, setGroups] = useState(initial);
  const [name, setName] = useState("");
  const [emails, setEmails] = useState("");
  const [saving, setSaving] = useState(false);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_notification_recipient_group", {
      p_org_id: orgId,
      p_group_id: null,
      p_name: name.trim(),
      p_member_user_ids: [],
      p_member_emails: parseEmails(emails),
      p_member_phones: [],
      p_telegram_chat_ids: [],
    });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Group saved" });
    setName("");
    setEmails("");
    const { data } = await supabase.rpc("list_notification_recipient_groups", { p_org_id: orgId });
    setGroups((data as NotificationRecipientGroupRow[]) ?? []);
    router.refresh();
  }

  async function removeGroup(id: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("delete_notification_recipient_group", {
      p_org_id: orgId,
      p_group_id: id,
    });
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setGroups((prev) => prev.filter((g) => g.id !== id));
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb="Communications"
        title="Recipient groups"
        description="Named lists of emails (and later Telegram chats) referenced from notification rules."
      />
      <CommunicationsSubNav active="/communications/groups" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Groups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No groups yet.</p>
            ) : (
              groups.map((g) => (
                <div key={g.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div>
                    <p className="font-medium">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.member_emails.length} email(s)
                      {g.telegram_chat_ids.length > 0 ? ` · ${g.telegram_chat_ids.length} Telegram` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => removeGroup(g.id)}>
                    Delete
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">New group</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createGroup} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Finance team" />
              </div>
              <div className="space-y-2">
                <Label>Emails (comma-separated)</Label>
                <textarea
                  className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={emails}
                  onChange={(e) => setEmails(e.target.value)}
                  placeholder="finance@company.com, cfo@company.com"
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Create group"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
