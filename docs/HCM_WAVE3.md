# HCM Wave 3 — Workforce Time

Wave 3 adds leave policies with balances, holiday calendars, attendance clock-in/out, shift scheduling, and basic overtime/late rules.

## Apply migrations

Run in order (after Waves 0–2):

1. `supabase/migrations/20260618000105_hcm_wave3_workforce_time.sql`
2. `supabase/migrations/20260618000106_hcm_wave3_rpcs.sql`

## What changed

### Leave types & balances (3.1)

- **`leave_types`** — annual, sick, unpaid (seeded per org).
- **`leave_balances`** — entitled / used / carried forward per employee per year.
- **`hr_count_leave_days`** — working days excluding weekends and holidays.
- **`submit_leave_request`** — validates balance, stores `leave_type_id` and `days_requested`.
- Balance deducted on approval (workflow or `review_leave_request`).

### Holiday calendars (3.2)

- **`holiday_calendars`** + **`holiday_dates`**
- Default calendar seeded per org; holidays excluded from leave day count.

### Attendance (3.4)

- **`attendance_records`** — clock in/out with method (`web`, `gps`, `qr`, `manual`).
- **`attendance_rules`** — late, early leave, overtime thresholds.
- RPCs: `clock_in`, `clock_out`, `get_my_attendance_status`, `list_attendance_records`.
- GPS attempted on clock-in when browser allows.

### Shifts (3.5)

- **`work_shifts`** — templates with start/end, break, grace period.
- **`shift_assignments`** — one shift per employee per day.
- Late detection compares clock-in to assigned shift + rules.

### Rules engine v1 (3.6)

- On clock-out: flags early leave, calculates overtime minutes vs shift duration.

## UI (`/time-off`)

| Tab | Features |
|-----|----------|
| **Leave** | Type selector, balance-aware submit, days column |
| **Balances** | Entitled / used / available; HR sync all |
| **Attendance** | Clock in/out (ESS), team history for HR |
| **Shifts** | Define shifts, assign schedule, manage holidays (HR) |

## Permissions

- Clock in/out: linked employee (`my_employee_id`).
- Shifts/holidays/balance sync: `user_can_manage_hr`.
- View attendance: self or HR manager.

## Next wave

Wave 4: payroll & compensation — see `docs/HCM_WAVE4.md`.
