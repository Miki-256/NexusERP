# HCM Wave 1 — Core Organization

Wave 1 adds org hierarchy, employee 360° profiles, HR documents, and a v1 workflow engine for leave approvals.

## Apply migrations

Run in order in Supabase SQL Editor (or `supabase db push`):

1. `supabase/migrations/20260618000101_hcm_wave1_core_organization.sql`
2. `supabase/migrations/20260618000102_hcm_wave1_rpcs.sql`

Requires Wave 0 (`20260618000100_hcm_wave0_foundation.sql`) first.

## What changed

### Organization hierarchy (1.1)

- **`org_units`** — HR org tree (company → department → team, etc.).
- **`hr_positions`** — job slots (distinct from recruitment `job_positions`).
- **`employees`** extended: `employee_number`, `org_unit_id`, `hr_position_id`, `manager_employee_id`.
- RPCs: `list_org_units`, `upsert_org_unit`, `get_org_chart`, `ensure_default_hr_org`, `sync_analytic_departments_to_org`.

### Employee 360° (1.2)

- **`employee_profiles`** — personal, address, IDs, emergency, bank, medical.
- **`employee_dependents`**
- **`employee_documents`** — typed docs with optional expiry.
- RPCs: `get_employee_360`, `save_employee_360`, `upsert_employee_document`.
- Visibility: HR managers see all; employees see self; direct managers see reports (via `user_can_view_employee`).

### Workflow engine v1 (1.3)

- Tables: `workflow_definitions`, `workflow_instances`, `workflow_approvals`.
- Default leave workflow: manager → HR (`ensure_default_hr_workflows`).
- **`submit_leave_request`** starts workflow when definition exists.
- **`approve_workflow_step`** — multi-step approve/reject; falls back to legacy `review_leave_request` in UI when no workflow.

### List enhancements

- **`list_hr_employees`** returns `employee_number`, `org_unit_id`, `org_unit_name`, `manager_employee_id`.

## UI

| Route / tab | Change |
|-------------|--------|
| `/hr` → **Organization** | Org tree, add/edit units, seed default, sync finance departments |
| `/hr` → **Employees** | Department column, links to 360° profile |
| `/hr/employees/[id]` | Tabbed profile: Overview, Personal, Employment, Documents, Leave |
| `/time-off` | Approve/reject uses workflow when present |

## Permissions

Same as Wave 0: `user_can_manage_hr` for writes; `user_has_hr_app_access` for org read; `user_can_view_employee` for profile access.

## Next wave

Wave 3: workforce time — leave policies, attendance, shifts.
