# HCM Wave 4 — Payroll & Compensation

Wave 4 adds pay components, automated payroll calculation, approval workflow, payslip breakdown, employee self-service payslips, and bank export.

## Apply migrations

Run in order (after Waves 0–3):

1. `supabase/migrations/20260618000107_hcm_wave4_payroll.sql`
2. `supabase/migrations/20260618000108_hcm_wave4_payroll_rpcs.sql`

## What changed

### Pay components (4.1)

- **`pay_components`** — earnings, deductions, tax, employer contributions.
- **`employee_pay_components`** — per-employee overrides.
- **`ensure_default_pay_components`** — seeds basic salary, transport, tax, pension per org.

### Calculation engine (4.2)

- **`calculate_employee_payroll`** — builds gross, allowances, deductions, tax, net from base salary + components.
- **`calculate_payroll_preview`** — org-wide preview for a pay period.
- **`payslip_lines`** — line-level breakdown on each payslip.

### Payroll lifecycle (4.3)

Extended **`payroll_status`**: `draft` → `pending_approval` → `approved` → `posted` (or `cancelled`).

| RPC | Purpose |
|-----|---------|
| `create_payroll_draft` | Create run with calculated payslips |
| `submit_payroll_run` | Submit for approval / start workflow |
| `approve_payroll_run` | Approve after workflow or direct |
| `post_payroll_run` | Post to ledger |
| `cancel_payroll_run` | Cancel draft/pending runs |
| `get_payroll_run_detail` | Run + payslips + lines (HR or own ESS) |
| `list_my_payslips` | Employee posted payslip history |
| `export_payroll_bank_file` | CSV for bank transfer (posted runs) |
| `run_payroll` | Legacy one-shot: manual lines or auto-calc + post |

### Salary history (4.4)

- **`salary_history`** — tracks base salary changes with effective dates.

### Workflow

- Default **`payroll_default`** workflow added via `ensure_default_hr_workflows`.
- `approve_workflow_step` handles `payroll_run` entity type.

## UI

### HR (`/hr` → Payroll tab)

- Preview calculation for a period.
- Create draft payroll run.
- History with links to run detail.
- Run detail (`/hr/payroll/[id]`): submit, approve, post, cancel, bank CSV export.

### Employee self-service (`/time-off` → Payslips tab)

- Lists posted payslips via `list_my_payslips`.
- Links to payslip breakdown (`/hr/payroll/[run_id]`).
- ESS users see only their own payslip lines (RPC filters by `my_employee_id`).

## Permissions

- Manage payroll: `user_can_manage_hr()`.
- View own payslip: linked employee with `user_has_hr_app_access()` (hr, recruitment, or timeoff app).
- Bank export: HR managers only, posted runs only.

## RLS

- Payslips and payroll runs readable by the linked employee (ESS).
- Payslip lines follow payslip access.
- Pay components: HR manage; employees read own assignments.

## Next wave

Wave 5: performance & learning — see `docs/HCM_WAVE5.md`.
