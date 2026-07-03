-- Free plan: show all modules in nav (owners/managers see full ERP).
-- Usage caps (stores, members, sales/month) remain enforced via 00030 triggers.
-- Pro/Enterprise can use modules JSON later for optional add-on gating.

UPDATE platform_plans
SET modules = NULL
WHERE id IN ('free', 'pro', 'enterprise');
