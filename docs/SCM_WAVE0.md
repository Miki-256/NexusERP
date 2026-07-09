# SCM Wave 0 — Stock Movement Ledger

Wave 0 introduces a unified stock movement ledger as the foundation for enterprise IMS/WMS. Existing behavior is preserved; `inventory_levels` remains the on-hand summary.

## Apply migrations

Run in order:

1. `supabase/migrations/20260618000118_scm_wave0_movement_ledger.sql`
2. `supabase/migrations/20260618000119_scm_wave0_movement_rpcs.sql`

After applying, backfill historical data (service role):

```sql
SELECT public.backfill_stock_movements_from_adjustments(NULL, 50000);
```

## What changed

### Schema

- **`stock_movements`** — immutable header: type, reference, user, timestamp, idempotency key.
- **`stock_movement_lines`** — signed quantity deltas per store × variant with before/after snapshots.
- **`stock_movement_type`** enum — adjustment, warehouse_transfer, purchase_receipt, production_receipt, sale_* (reserved), etc.
- **Indexes** on `inventory_levels` and `inventory_adjustments` for scale.

### Engine

- **`_apply_stock_movement`** — internal SECURITY DEFINER engine:
  - Sorted row locking (deadlock-safe)
  - Negative stock guard
  - Idempotency via `idempotency_key`
  - Updates `inventory_levels` atomically

### Refactored RPCs (behavior-identical)

| RPC | Movement type | Legacy `inventory_adjustments` |
|-----|---------------|-------------------------------|
| `adjust_inventory` | `adjustment` | Yes |
| `transfer_stock` | `warehouse_transfer` | Yes (2 rows) |
| `receive_purchase_order` | `purchase_receipt` | Yes (per line) |
| `complete_manufacturing_order` | `production_receipt` | No (new) |

### New read APIs

- `list_stock_movements` — paginated movement history with line detail.
- `list_inventory_levels_page` — paginated, searchable store stock list.

### UI (`/inventory`)

| Tab | Features |
|-----|----------|
| **Stock levels** | Server pagination, search, adjust form |
| **Movements** | Movement history from ledger |
| **Transfers** | Unchanged |
| **Low stock** | Unchanged |

## Not yet routed through ledger

These still update `inventory_levels` directly (addressed in Wave 1 for most paths; remaining):

- Sale voids / returns
- Location-level bin quantities (Wave 3)

Wave 1 completed ledger routing for: `complete_sale`, `import_products`, `bulk_receive_products`, `create_product_with_variant` initial stock. See [SCM_WAVE1.md](./SCM_WAVE1.md).

## Permissions

- Read movements: `user_has_org_access`
- Write movements: via existing manager RPCs (`user_can_manage`)

## Next wave

Wave 1 — Enterprise PIM foundation (multi-variant, UOM, multiple barcodes).
