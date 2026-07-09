# HCM Wave 0 — Foundation & Hardening

Wave 0 secures the existing HR slice and prepares the platform for enterprise HCM expansion.

## Apply migration

Run in Supabase SQL Editor (or `supabase db push`):

`supabase/migrations/20260618000100_hcm_wave0_foundation.sql`

## What changed

### Security (0.1, 0.2)

- **`user_can_manage_hr(org_id)`** — org owners/managers **or** members with HR app manage scope (`hr`, `recruitment`, `timeoff` via department roles).
- **`user_has_hr_app_access(org_id)`** — any HR-category app access.
- **RLS hardening:**
  - `employees` — read: HR managers or linked self only; write: `user_can_manage_hr`.
  - `leave_requests` — no direct INSERT/UPDATE; RPC-only workflow.
  - `job_applicants` / `job_positions` — writes require `user_can_manage_hr`.
  - Payroll tables — read requires `user_can_manage_hr`.

### Employee ↔ ERP user link (0.3)

- Unique `(organization_id, user_id)` on `employees`.
- **`my_employee_id(org_id)`** — current user's linked employee.
- **`link_employee_to_user(employee_id, user_id)`** — manager RPC.
- **`submit_leave_request`** — self-service only for linked employee unless HR manager.
- HR employee form: **Link ERP user** dropdown.

### Shared library (0.4)

- `apps/web/src/lib/hr/constants.ts`
- `apps/web/src/lib/hr/types.ts`
- `apps/web/src/lib/hr/mutations.ts`

### Notifications (0.5)

Events: `hr.leave_requested`, `hr.leave_reviewed`, `hr.payroll_completed`

Templates + default in-app rules seeded via `ensure_hr_notification_rules`.

### Pagination (0.6)

Server-side RPCs with search/filters:

- `list_hr_employees`
- `list_leave_requests`
- `list_job_positions`
- `list_job_applicants`
- `list_timeoff_employees` (directory for leave form)

UI: `/hr`, `/time-off`, `/recruitment` use `TableToolbar` + `TablePagination`.

### Audit log (0.7)

- Table: `hr_audit_logs`
- Written on leave submit/review, payroll post, employee user link.

## UI behavior

| Page | Change |
|------|--------|
| `/hr` | Search, status filter, pagination; salary hidden unless HR manage; link ERP user |
| `/time-off` | `submit_leave_request` RPC; self-service when linked; status filter + pagination |
| `/recruitment` | Write actions gated by `canManage`; search/filter + pagination |

## Next wave

Wave 1: org hierarchy, employee 360° profile, document linkage, workflow engine v1.
