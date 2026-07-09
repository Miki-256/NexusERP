# HCM Wave 5 — Performance & Learning

Wave 5 adds performance goals, review cycles, competency ratings, skills catalog, and training records with employee self-service on Time Off.

## Apply migrations

Run in order (after Waves 0–4):

1. `supabase/migrations/20260618000109_hcm_wave5_performance.sql`
2. `supabase/migrations/20260618000110_hcm_wave5_performance_rpcs.sql`

## What changed

### Skills (5.1)

- **`skills`** — org skill catalog (communication, leadership, technical, etc.).
- **`employee_skills`** — proficiency levels per employee.
- RPCs: `list_skills`, `upsert_skill`, `list_employee_skills`, `set_employee_skill`.
- Defaults seeded via `ensure_default_skills`.

### Performance goals (5.2)

- **`performance_goals`** — title, target date, weight, progress %, status.
- RPCs: `list_performance_goals`, `create_performance_goal`, `update_goal_progress`, `list_my_goals`.
- Employees and managers can update progress on active goals.

### Review cycles (5.3)

- **`review_cycles`** — named periods (e.g. H1 2026).
- **`performance_reviews`** — one review per employee per cycle.
- **`review_ratings`** — competency criteria with self and manager ratings (1–5).
- RPCs: `list_review_cycles`, `create_review_cycle`, `activate_review_cycle`, `list_performance_reviews`, `get_performance_review`.
- `activate_review_cycle` creates reviews for all active employees with default criteria.

### Review workflow (5.4)

| Step | RPC | Who |
|------|-----|-----|
| Self assessment | `save_performance_review_self` | Employee |
| Submit to manager | `submit_performance_review(p_as_manager=false)` | Employee |
| Manager assessment | `save_performance_review_manager` | Manager / HR |
| Submit for approval | `submit_performance_review(p_as_manager=true)` | Manager |
| Approve | `approve_workflow_step` or `approve_performance_review` | Manager → HR |

Default **`performance_review_default`** workflow: Manager → HR.

### Training (5.5)

- **`training_courses`** — course catalog with mandatory flag.
- **`employee_training_records`** — planned / in progress / completed.
- RPCs: `list_training_courses`, `upsert_training_course`, `list_employee_training`, `record_employee_training`, `list_my_training`.
- Defaults seeded via `ensure_default_training_courses`.

## UI

### HR (`/hr` → Performance tab)

| Sub-tab | Features |
|---------|----------|
| **Goals** | Create goals, track progress |
| **Reviews** | Create cycles, launch reviews, open/save/submit/approve |
| **Skills** | Assign skills from catalog |
| **Training** | Assign courses, view records |

### Employee self-service (`/time-off` → Growth tab)

- My goals with progress updates
- My review history
- My training records

## Permissions

- Manage goals, cycles, skills, training: `user_can_manage_hr()`.
- View employee goals/reviews/training: `user_can_view_employee()` (self, manager, HR).
- Update own goal progress: linked employee.
- Self review: reviewee; manager review: assigned reviewer or HR.

## Next wave

Wave 6: benefits & compliance — see `docs/HCM_WAVE6.md`.
