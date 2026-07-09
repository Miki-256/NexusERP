# HCM Wave 8 — Employee Lifecycle Automation

Wave 8 adds offboarding checklists, probation reviews, employment contract renewals, and lifecycle alert scanning.

## Apply migrations

Run in order (after Waves 0–7):

1. `supabase/migrations/20260618000114_hcm_wave8_lifecycle.sql`
2. `supabase/migrations/20260618000115_hcm_wave8_lifecycle_rpcs.sql`

## What changed

### Offboarding (8.1)

- **`offboarding_templates`** + **`offboarding_tasks`** — mirror onboarding pattern.
- `ensure_default_offboarding_template` — exit interview, assets, access, payroll, letter.
- `start_employee_offboarding` — sets last working day, seeds checklist, notifies HR.
- `finalize_employee_offboarding` — marks employee terminated when checklist complete.
- RPCs: `list_offboarding_tasks`, `update_offboarding_task`, `list_my_offboarding_tasks`.

### Probation reviews (8.2)

- **`probation_reviews`** — pending → passed / extended / failed.
- `schedule_probation_review` — sets `probation_end_date` on profile.
- `complete_probation_review` — pass, extend (new date), or fail (terminates employee).
- `list_probation_reviews` — paginated with manager access.

### Employment contracts (8.3)

- **`employment_contracts`** — fixed-term tracking with renewal chain.
- `create_employment_contract`, `renew_employment_contract`.
- `list_employment_contracts`, `list_contracts_due_for_renewal`.

### Lifecycle alerts (8.4)

- `scan_lifecycle_alerts` — idempotent HR notifications for:
  - Probation reviews due within N days
  - Contracts expiring within N days
- Uses existing `compliance_alert_log` from Wave 6.

### Notifications

- `hr.offboarding_started` — HR in-app when offboarding begins.
- `hr.probation_due` — HR in-app for upcoming probation end.
- `hr.contract_expiring` — HR in-app for contract renewal.

## UI

### HR (`/hr` → Lifecycle tab)

| Sub-tab | Features |
|---------|----------|
| **Offboarding** | Start checklist, complete tasks, finalize termination |
| **Probation** | Schedule reviews, pass / extend / fail |
| **Contracts** | Create contracts, renew expiring, due-for-renewal banner |

### Employee self-service (`/time-off` → Growth tab)

- Exit checklist tasks when offboarding is active.

## Permissions

- Manage lifecycle: `user_can_manage_hr()`.
- View own offboarding tasks: linked employee.
- Probation: HR, assigned reviewer, or `user_can_view_employee`.

## Next wave

Wave 9: integrations & exports — HR data export, payroll GL mapping, external webhook hooks.
