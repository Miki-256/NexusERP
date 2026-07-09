# SCM Wave 3 — WMS & Fulfillment

Wave 3 adds bin-level stock, putaway transfers, and a warehouse fulfillment workflow (pick → pack → ship) with shipment tracking. POS checkout is unchanged — fulfillment orders are for warehouse outbound.

## Apply migrations

Run after Wave 2:

1. `supabase/migrations/20260618000124_scm_wave3_wms.sql`
2. `supabase/migrations/20260618000125_scm_wave3_wms_rpcs.sql`

## Schema

| Area | Objects |
|------|---------|
| **Bin stock** | `location_balances` — qty per storage location (store on-hand remains `inventory_levels`) |
| **Fulfillment** | `fulfillment_orders`, `fulfillment_order_lines` |
| **Logistics** | `shipments` — carrier, tracking, status |
| **Mobile** | `storage_locations.location_barcode` for scan-to-resolve |
| **Movements** | `location_transfer`, `fulfillment_shipment`; `location_id` on movement lines |

## Workflow

1. **Sync bins** — `sync_default_location_balances` allocates unlocated store qty to DEFAULT zone
2. **Putaway** — `putaway_stock` moves qty between bins (no store total change)
3. **Create FO** — `create_fulfillment_order` → `release_fulfillment_order`
4. **Pick** — `pick_fulfillment_line` moves bin → STAGING location
5. **Pack** — `pack_fulfillment_order`
6. **Ship** — `ship_fulfillment_order` deducts `inventory_levels` via `fulfillment_shipment`, creates `shipments` row

## Key RPCs

| RPC | Purpose |
|-----|---------|
| `list_location_balances` | Bin-level stock view |
| `putaway_stock` | Transfer between locations |
| `sync_default_location_balances` | Seed DEFAULT zone from store on-hand |
| `create_fulfillment_order` | New warehouse ship order |
| `pick_fulfillment_line` | Pick from bin to staging |
| `ship_fulfillment_order` | Deduct stock + shipment record |
| `resolve_location_by_barcode` | Mobile location scan |

## UI

**`/fulfillment`** — Orders, Pick (scan + mobile cards), Putaway (bin transfers)

Uses **Inventory** app permissions (`fulfillment` route maps to `inventory`).

## Not in Wave 3

- POS sale-linked auto-fulfillment (sales still deduct at checkout)
- FEFO lot pick allocation on ship
- Carrier API integrations

## Next wave

**Wave 4 — Analytics & scale:** forecasting, e-commerce sync, enterprise reporting.
