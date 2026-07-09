# SCM / WMS Roadmap (4 mega-waves)

Enterprise inventory evolution from retail POS stock tracking to SAP/NetSuite-class IMS/WMS/SCM.

| Wave | Status | Scope |
|------|--------|-------|
| **0** | ✅ Done | Unified stock movement ledger, paginated inventory UI, movement history |
| **1** | ✅ Done | PIM extensions, warehouse hierarchy, full ledger coverage, FIFO cost layers |
| **2** | ✅ Done | Batch/lot, quality, cycle counting, MRP, procurement automation |
| **3** | ✅ Done | WMS fulfillment, pick/pack/ship, bin stock, mobile scan |
| **4** | ✅ Done | Analytics, forecasting, valuation, e-commerce sync foundation |

## Design principles

- **`stores` remain** — retail POS unchanged; each store gets a linked `warehouses` row.
- **`inventory_levels` remain** — on-hand summary updated only via `_apply_stock_movement`.
- **`inventory_adjustments` kept** — legacy audit trail; wrappers dual-write where needed.
- **Incremental adoption** — each wave ships migrations + RPCs + UI without breaking POS.

## Migration order (Waves 0–4)

1. `20260618000118_scm_wave0_movement_ledger.sql`
2. `20260618000119_scm_wave0_movement_rpcs.sql`
3. `20260618000120_scm_wave1_platform.sql`
4. `20260618000121_scm_wave1_platform_rpcs.sql`
5. `20260618000122_scm_wave2_operations.sql`
6. `20260618000123_scm_wave2_operations_rpcs.sql`
7. `20260618000124_scm_wave3_wms.sql`
8. `20260618000125_scm_wave3_wms_rpcs.sql`
9. `20260618000126_scm_wave4_analytics.sql`
10. `20260618000127_scm_wave4_analytics_rpcs.sql`

See [SCM_WAVE0.md](./SCM_WAVE0.md) through [SCM_WAVE4.md](./SCM_WAVE4.md) for details.

**Program status: all 4 mega-waves complete.**
