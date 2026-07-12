"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Building2, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchOrganization } from "@/app/actions/switch-organization";
import { markSessionBoot } from "@/components/ui/loading";
import type { WorkspaceSummary } from "@/lib/active-org";

export function OrgSwitcher({
  orgName,
  activeOrganizationId,
  workspaces,
  canManageTeam,
}: {
  orgName: string;
  activeOrganizationId: string;
  workspaces: WorkspaceSummary[];
  canManageTeam: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const hasMultiple = workspaces.length > 1;

  function handleSwitch(organizationId: string) {
    if (organizationId === activeOrganizationId) return;
    startTransition(async () => {
      markSessionBoot();
      await switchOrganization(organizationId);
    });
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 sm:px-3"
          disabled={pending}
          aria-label={hasMultiple ? `Switch company, ${orgName}` : `Organization, ${orgName}`}
        >
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="hidden max-w-[120px] truncate font-medium sm:inline md:max-w-[160px]">{orgName}</span>
          {hasMultiple && <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {hasMultiple ? "Switch company" : "Organization"}
        </DropdownMenuLabel>
        {hasMultiple ? (
          workspaces.map((ws) => (
            <DropdownMenuItem
              key={ws.organization_id}
              onClick={() => handleSwitch(ws.organization_id)}
              className="flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{ws.organization_name}</p>
                <p className="text-xs capitalize text-muted-foreground">{ws.role}</p>
              </div>
              {ws.organization_id === activeOrganizationId && (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>{orgName}</DropdownMenuItem>
        )}
        {canManageTeam && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">Organization settings</Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
