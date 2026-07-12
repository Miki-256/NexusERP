# EFM Wave 10 — Cost & Project Accounting

**Status:** Complete (code) — apply migrations `00150` → `00151` on Supabase.

Wave 10 adds enterprise job costing: cost centers, project financial profiles, budget-by-category, GL-tagged job cost reports, and cost allocations.

## Deliverables

| Item | Migration / file | Notes |
|------|------------------|-------|
| Job cost schema | `20260618000150_efm_wave10_project_cost.sql` | Cost centers, project fields, budgets, allocations |
| Job cost RPCs | `20260618000151_efm_wave10_project_cost_rpcs.sql` | Reports, allocations, CRUD |
| Job Cost tab | `job-cost-tab.tsx` | Centers, project rollup, detail, allocate |

## RPCs (Wave 10)

| RPC | Purpose |
|-----|---------|
| `list_cost_centers` | Cost center catalog with project counts |
| `upsert_cost_center` | Create/update cost center |
| `upsert_project_financials` | Project code, budgets, contract, center, status |
| `set_project_cost_budget` | Category budget lines (labor, materials, etc.) |
| `list_projects_job_cost` | All projects with budget vs actual summary |
| `get_project_job_cost` | Project detail: GL lines, category budget vs actual |
| `get_cost_center_summary` | Roll up project-tagged revenue/cost by center |
| `post_project_cost_allocation` | Post balanced JE with project_id tag |

## Model

- **Job cost** derives from `journal_entry_lines.project_id` (Phase E analytic tags).
- **Cost centers** group projects; optional link to `analytic_departments`.
- **Category budgets** track labor/materials/subcontract/overhead per project.
- **Allocations** post Dr destination expense (tagged to project) / Cr source expense.

## Apply migrations

```bash
# After Wave 9 (00148–00149):
# 00150 — EFM Wave 10 schema
# 00151 — EFM Wave 10 RPCs
npm run db:push
```

## Verify

```bash
npm run verify:supabase
npm run test:integration
npm run typecheck
```

## UI surfaces

- **Financials → Job Cost** — cost centers, project job cost, allocations
- **Financials → Analytics** — unchanged store/project/department dimension views
- **Projects app** — operational tasks; financial profile via Financials

## Next wave

**EFM Wave 12 — Executive dashboards & drill-down.**
