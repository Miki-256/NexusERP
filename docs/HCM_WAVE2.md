# HCM Wave 2 — Talent Acquisition & Onboarding

Wave 2 upgrades recruitment from a simple job/applicant list into a structured hire-to-onboard flow.

## Apply migrations

Run in order (after Wave 0–1):

1. `supabase/migrations/20260618000103_hcm_wave2_talent_onboarding.sql`
2. `supabase/migrations/20260618000104_hcm_wave2_rpcs.sql`

## What changed

### Job requisitions (2.1)

- Table: `job_requisitions` — draft → approval → post as `job_positions`.
- Workflow: `job_requisition_default` (HR approval) via existing workflow engine.
- RPCs: `list_job_requisitions`, `upsert_job_requisition`, `submit_job_requisition`, `publish_job_requisition`.

### Enhanced ATS (2.2–2.3)

- `applicant_interviews` — schedule, scorecard JSONB, interviewer link.
- `job_offers` — salary, start date, offer letter URL, status lifecycle.
- RPCs: `get_applicant_pipeline`, `schedule_applicant_interview`, `save_interview_scorecard`, `upsert_job_offer`.

### Hire → employee + invite (2.4)

- **`hire_applicant`** creates:
  - `employees` row from applicant + offer data
  - `staff_invites` when email present (re-send safe on conflict)
  - Onboarding checklist from default template

### Onboarding checklist (2.5)

- `onboarding_templates` + `onboarding_tasks`
- Default template seeded: IT account, equipment, orientation, manager welcome.
- RPCs: `list_onboarding_tasks`, `update_onboarding_task`, `ensure_default_onboarding_template`.

### Extended tables

- `job_positions`: `requisition_id`, `org_unit_id`, `employment_type`, `is_public`
- `job_applicants`: `hired_employee_id`, `resume_url`, `source`

## UI

| Route / tab | Change |
|-------------|--------|
| `/recruitment` → **Requisitions** | Create, submit, approve, post jobs |
| `/recruitment` → **Applicants** | Links to full pipeline |
| `/recruitment/applicants/[id]` | Interviews, offers, hire action |
| `/recruitment` → **Onboarding** | Task checklist for new hires |

## Permissions

Same HR app permissions as Wave 0–1: `user_can_manage_hr` for writes; `user_has_hr_app_access` for reads. Onboarding tasks visible to HR managers or the linked employee (self).

## Next wave

Wave 4: payroll & compensation — pay components, calculation engine, payslips.
