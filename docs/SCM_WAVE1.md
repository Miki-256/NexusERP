# SCM Wave 1 — Product & Location Platform

Wave 1 extends the Wave 0 movement ledger with enterprise PIM fields, warehouse/location hierarchy, full stock-path ledger coverage, and FIFO cost-layer foundation.

## Apply migrations

Run after Wave 0:

1. `supabase/migrations/20260618000120_scm_wave1_platform.sql`
2. `supabase/migrations/20260618000121_scm_wave1_platform_rpcs.sql`

## Schema

### PIM extensions (`products`)

- `lifecycle_status` — draft, active, discontinued, obsolete
- `base_uom_code`, dimensions (`weight_kg`, `length_cm`, …), `hs_code`, `country_of_origin`, `shelf_life_days`, `description`

### New tables

| Table | Purpose |
|-------|---------|
| `product_barcodes` | Multiple barcodes per variant |
| `product_uoms` | Units of measure & conversions |
| `product_suppliers` | Vendor catalog links |
| `warehouses` | 1:1 with `stores` (auto-provisioned) |
| `storage_locations` | Zone → bin hierarchy |
| `warehouse_user_access` | Per-warehouse capabilities |
| `inventory_cost_layers` | FIFO layer tracking |

### Organization settings

- `organizations.inventory_costing_method` — `moving_average` (default), `fifo`, `standard`
- `organizations.inventory_standard_cost_auto_update`

## Ledger coverage (Wave 1)

These paths now route through `_apply_stock_movement` / `_apply_stock_in`:

| RPC | Movement type |
|-----|---------------|
| `complete_sale` | `sale_shipment` (batch via `_record_sale_stock_movement`) |
| `import_products` | `import_receipt` |
| `bulk_receive_products` | `bulk_receive` |
| `create_product_with_variant` | `initial_stock` |
| `receive_purchase_order` | `purchase_receipt` + FIFO layers when org method = `fifo` |

Stock validation in `complete_sale` still reads `inventory_levels` before checkout; deduction uses the ledger.

## New RPCs

| RPC | Description |
|-----|-------------|
| `ensure_org_warehouses` | Provision warehouse + default zone per store |
| `list_warehouses` | Org warehouse list (auto-provisions) |
| `list_storage_locations` | Locations under a warehouse |
| `upsert_storage_location` | Create/update bin/zone |
| `get_product_detail` | Product + variants + barcodes + UOMs + suppliers |
| `update_product_extended` | Lifecycle, dimensions, HS code, etc. |
| `upsert_product_variant` / `upsert_product_barcode` | Multi-variant & barcode management |
| `update_org_inventory_settings` | Costing method |
| `find_product_by_barcode` | Extended to `product_barcodes` |

Internal helpers: `_apply_stock_in`, `_add_inventory_cost_layer`, `_record_sale_stock_movement`.

## UI

### `/inventory` — Warehouses tab

Lists warehouses (linked stores), location counts, and storage locations. Managers can add locations.

### `/products` — Extended fields (edit)

Lifecycle status, description, dimensions, HS code, country of origin, shelf life.

## Not yet in ledger

- Sale voids / returns
- Location-level stock (bin quantities) — Wave 3 WMS

## Next wave

**Wave 2 — Operations:** batch/lot tracking, quality holds, cycle counting, MRP, procurement workflows.
