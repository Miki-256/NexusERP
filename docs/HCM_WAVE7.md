# HCM Wave 7 — Workforce Analytics

Wave 7 adds an HR analytics dashboard with headcount, turnover, absence, and workforce composition metrics computed from existing HCM data.

## Apply migrations

Run after Waves 0–6:

1. `supabase/migrations/20260618000113_hcm_wave7_analytics_rpcs.sql`

No new tables — analytics are computed on demand from employees, leave, attendance, org units, and recruitment data.

## What changed

### Analytics RPCs (7.1)

| RPC | Purpose |
|-----|---------|
| `_hr_headcount_on_date` | Point-in-time headcount (hires minus terminations) |
| `get_hr_workforce_dashboard` | Full dashboard bundle for a date range |

### Dashboard metrics (7.2)

**Summary KPIs:**
- Active headcount, on leave, total roster
- New hires and departures in period
- Turnover rate % (departures ÷ average headcount)
- Approved leave days and absence rate %
- Average tenure (months)
- Open job requisitions
- Attendance coverage % (employees with clock-ins)
- Pending leave requests

**Charts & breakdowns:**
- 12-month headcount trend
- Headcount by org unit
- Headcount by employment type
- Leave days by type
- Recent hires and departures tables

### Data sources

- `employees` + `employee_profiles` (hire/termination dates, status)
- `leave_requests` + `leave_types` (absence)
- `attendance_records` (coverage)
- `org_units` (department breakdown)
- `job_requisitions` (open reqs)

## UI

### HR (`/hr` → Analytics tab)

- Date range filter with refresh
- KPI stat cards
- Bar charts (headcount trend, org unit, leave type, employment mix)
- Recent hires / departures tables

## Permissions

- Dashboard read: `user_has_hr_app_access()` (hr, recruitment, or timeoff app).
- Analytics tab visible to HR managers (`canManageApp("hr")`).

## Next wave

Wave 8: employee lifecycle automation — see `docs/HCM_WAVE8.md`.
