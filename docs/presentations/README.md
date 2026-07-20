# NexusERP presentations

## User Operations Manual (primary end-user guide)

[NexusERP-User-Operations-Manual.pptx](./NexusERP-User-Operations-Manual.pptx)

Professional department-by-department how-to for cashiers, store managers, inventory/purchasing, finance, HR, and administrators.

**Contents (approx. 40+ slides):** getting started & roles · Sales/POS · Inventory & Purchase · Financial hub · HR/Payroll · Services & Settings · order-to-cash / procure-to-pay · daily checklist · troubleshooting.

Grounded in the live app registry (`apps/web/src/lib/apps-registry.ts`) and shipped screens — not a sales pitch.

### Regenerate

```bash
npm install --no-save pptxgenjs
node scripts/build-user-manual-pptx.mjs
```

---

## Finance Process Validation Workshop

[NexusERP-Finance-Process-Validation-Workshop.pptx](./NexusERP-Finance-Process-Validation-Workshop.pptx)

Boardroom deck for controllers/CFOs (accounting process evidence, not end-user training).

### Regenerate

```bash
npm install --no-save pptxgenjs
node scripts/build-finance-validation-pptx.mjs
```
