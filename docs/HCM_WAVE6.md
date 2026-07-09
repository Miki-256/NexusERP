# HCM Wave 6 — Benefits & Compliance

Wave 6 adds benefit plans and enrollments, HR policy acknowledgements, and document/identity expiry compliance alerts.

## Apply migrations

Run in order (after Waves 0–5):

1. `supabase/migrations/20260618000111_hcm_wave6_benefits_compliance.sql`
2. `supabase/migrations/20260618000112_hcm_wave6_benefits_rpcs.sql`

## What changed

### Benefit plans (6.1)

- **`benefit_plans`** — health, dental, life, retirement, other.
- **`benefit_enrollments`** — employee enrollments with status and coverage level.
- RPCs: `list_benefit_plans`, `upsert_benefit_plan`, `list_benefit_enrollments`, `enroll_employee_benefit`, `update_benefit_enrollment`, `list_my_benefits`.
- Defaults seeded via `ensure_default_benefit_plans`.

### HR policies (6.2)

- **`hr_policies`** — versioned policies with acknowledgement requirement.
- **`policy_acknowledgements`** — employee sign-off per policy version.
- RPCs: `list_hr_policies`, `upsert_hr_policy`, `list_pending_policies`, `acknowledge_hr_policy`, `list_policy_acknowledgements`.
- Defaults seeded via `ensure_default_hr_policies` (code of conduct, data privacy, health & safety).

### Compliance expiry (6.3)

- Aggregates expiring items from:
  - `employee_documents.expires_at`
  - `employee_profiles` passport, visa, driving license expiry
- **`compliance_alert_log`** — idempotent notification dispatch tracking.
- RPCs: `list_expiring_compliance_items`, `scan_hr_compliance_alerts`.
- Notifications: `hr.document_expiring` → HR managers in-app.

### Notifications

- `hr.document_expiring` — HR alert for expiring documents/IDs.
- `hr.policy_pending` — employee alert for required acknowledgements (rule registered for future batch use).

## UI

### HR (`/hr` → Benefits tab)

| Sub-tab | Features |
|---------|----------|
| **Enrollments** | Enroll employees, terminate coverage |
| **Plans** | View plan catalog and costs |
| **Policies** | View policies and acknowledgement history |
| **Compliance** | Expiring items list, scan & notify HR |

### Employee self-service (`/time-off` → Benefits tab)

- My active benefit enrollments
- Pending policies to acknowledge

## Permissions

- Manage plans, enrollments, policies: `user_can_manage_hr()`.
- View own benefits / acknowledge policies: linked employee with `user_has_hr_app_access()`.
- Compliance scan and expiry list: HR managers only.

## Next wave

Wave 7: workforce analytics — see `docs/HCM_WAVE7.md`.
