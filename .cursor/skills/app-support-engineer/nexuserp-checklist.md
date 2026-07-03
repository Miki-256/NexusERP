# NexusERP — support engineer reference

Quick map for audits. Read only the sections relevant to scope.

## Repo layout

| Path | Purpose |
|------|---------|
| `apps/web/` | Next.js 15 tenant + admin UI |
| `apps/web/src/app/(tenant)/` | Logged-in ERP modules |
| `apps/web/src/app/admin/` | Platform admin control plane |
| `apps/web/src/app/(auth)/` | Login, signup, reset |
| `apps/web/src/lib/` | Shared server/client logic |
| `supabase/migrations/` | SQL migrations (apply in order) |

## Critical flows

### Workspace bootstrap (onboarding blink fix)

1. User logs in → may hit `/api/workspace/bootstrap`
2. `resolveUserWorkspace()` in `lib/workspace.ts` picks active org
3. Cookie sync via Route Handler (Server Components cannot set cookies reliably)
4. Failure symptom: loop between `/onboarding` and `/dashboard`

### Org approval gate

- New orgs: `status = pending` until platform admin approves
- Waiting screen: `/pending-approval`
- Workspace RPCs return **active** orgs only for normal users
- Migration: `20260618000023_org_approval_gate.sql`

### Multi-org switcher

- Cookie: `ACTIVE_ORG_COOKIE` in `lib/active-org.ts`
- RPC: `list_my_workspaces`, `switch_workspace`
- Migrations: `00021`, `00022`

## Platform admin phases (migrations)

Apply in order if missing:

| Migration | Phase |
|-----------|-------|
| `20260618000025_platform_admin_phase_a_fix.sql` | A — foundation (prefer over `00024`) |
| `20260618000027_platform_admin_phase_b.sql` | B — support toolkit |
| `20260618000028_platform_admin_phase_c.sql` | C — security |
| `20260618000029_platform_admin_phase_d.sql` | D — plans, health, flags, export |

Common SQL errors:
- `platform_admin_can_read()` missing → function order in migration
- Return type change → need `DROP FUNCTION` before recreate

## Admin routes (expected)

- `/admin` — overview
- `/admin/organizations`, `/admin/organizations/[id]`
- `/admin/support`, `/admin/users`, `/admin/security`
- `/admin/plans`, `/admin/health`, `/admin/features`
- `/admin/audit`, `/admin/settings`, `/admin/admins`, `/admin/import`

## Env vars (`apps/web/.env.local`)

| Variable | Required for |
|----------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | All Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Invite signup, user disable/revoke, some exports |

Never log or commit secret values.

## Diagnostic commands

```bash
# From repo root
npm run build
npm run lint

# Dev (user machine)
cd apps/web && npm run dev:fresh
```

## RPC spot-check (grep app → verify SQL)

Common admin RPCs: `admin_my_role`, `admin_list_pending_organizations`, `admin_get_organization_detail`, `admin_set_org_status`, `admin_get_platform_health`, `admin_export_organization`, `get_org_enabled_app_ids`.

Tenant RPCs: `get_my_app_permissions`, `list_my_workspaces`, `get_my_workspace`.

## Browser smoke URLs

- `/login` — auth form
- `/dashboard` — tenant home (needs session)
- `/admin` — platform admin (needs platform admin role)
- `/pending-approval` — pending org gate
- `/maintenance` — maintenance mode page

## Fix discipline

- One issue per user confirmation
- Minimal diff
- Re-run build after fix
- No commit unless asked
