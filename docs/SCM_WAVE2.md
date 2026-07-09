# SCM Wave 2 — Operations

Wave 2 adds operational inventory control: lot tracking, quality holds, cycle counting, MRP, and procurement requisitions with partial PO receipt.

## Apply migrations

Run after Wave 1:

1. `supabase/migrations/20260618000122_scm_wave2_operations.sql`
2. `supabase/migrations/20260618000123_scm_wave2_operations_rpcs.sql`

## Schema

| Area | Tables / changes |
|------|------------------|
| **Lots** | `inventory_lots`, `lot_balances`; `products.track_lots`; `lot_id` on movement lines & cost layers |
| **Quality** | `quality_holds` — blocks outbound stock moves |
| **Cycle count** | `cycle_count_sessions`, `cycle_count_lines`; movement type `cycle_count_adjustment` |
| **MRP** | `mrp_runs`, `mrp_suggestions` |
| **Procurement** | `purchase_requisitions`, `purchase_requisition_lines`; `purchase_order_lines.qty_received`; `po_status.partially_received` |

## Key RPCs

| RPC | Purpose |
|-----|---------|
| `set_product_lot_tracking` | Enable lot capture on PO receipt |
| `list_inventory_lots` | Lot inventory by store/variant |
| `place_quality_hold` / `release_quality_hold` | QC block on outbound moves |
| `create_cycle_count_session` | Snapshot store stock for counting |
| `record_cycle_count_line` | Enter counted qty per SKU |
| `finalize_cycle_count` | Post variances via ledger |
| `run_mrp` | Reorder point + MO component demand |
| `list_mrp_suggestions` | Review replenishment suggestions |
| `create_requisition_from_mrp` | Build requisition from suggestions |
| `convert_requisition_to_po` | Create PO from approved requisition |
| `receive_purchase_order(po, lines?)` | Partial receipt + optional lot numbers |

## Movement engine updates

`_apply_stock_movement` now:

- Rejects negative deltas when variant is on **quality hold**
- Updates **lot_balances** when `lot_id` is present on a line

## UI

| Location | Feature |
|----------|---------|
| `/inventory` → **Operations** | Cycle counts, quality holds |
| `/purchasing` → **MRP & requisitions** | Run MRP, requisitions, convert to PO |
| `/products` → Edit | **Track lots** checkbox |

## Not in Wave 2

- FEFO/FIFO lot allocation on sales (Wave 3)
- Serial numbers
- Full approval workflow on requisitions

## Next wave

**Wave 3 — WMS & fulfillment:** ✅ See [SCM_WAVE3.md](./SCM_WAVE3.md).

**Wave 4 — Analytics & scale** is next.
