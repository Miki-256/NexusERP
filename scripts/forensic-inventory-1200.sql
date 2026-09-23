-- Forensic: Inventory (1200) GL balance vs expected capitalization / relief
-- Read-only. Do NOT invent balancing journal entries from this script.
--
-- Usage (Supabase SQL editor or psql):
--   \set org_id 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
--   then run the queries below (replace :org_id).
--
-- Methodology:
-- 1) Net GL balance on account 1200 = SUM(debit - credit) on posted JEs.
--    Asset should normally be a debit (positive) balance.
-- 2) Expected from purchasing: SUM of PO receipt / vendor bill inventory debits.
-- 3) Expected relief from sales: SUM of COGS inventory credits on sale JEs.
-- 4) Gap ≈ (receipts capitalized) - (sale relief) - (manual/other 1200 lines).
--    A large credit balance usually means relief (sales/adjustments) without matching
--    capitalization (unposted receipts, stock adjustments without JE, or historical
--    manual credits). Current sale poster correctly credits 1200; PO receive debits 1200.

-- Replace this UUID before running:
-- org: set in WHERE clauses as needed

WITH org AS (
  SELECT id
  FROM organizations
  WHERE name ILIKE '%Olana%'
  ORDER BY created_at
  LIMIT 1
),
inv_acct AS (
  SELECT a.id AS account_id, a.organization_id
  FROM accounts a
  JOIN org o ON o.id = a.organization_id
  WHERE a.code = '1200'
),
gl_1200 AS (
  SELECT
    ia.organization_id,
    COALESCE(SUM(jel.debit - jel.credit), 0) AS net_debit_balance,
    COALESCE(SUM(jel.debit), 0) AS total_debits,
    COALESCE(SUM(jel.credit), 0) AS total_credits,
    COUNT(*) AS line_count
  FROM inv_acct ia
  JOIN journal_entry_lines jel ON jel.account_id = ia.account_id
  JOIN journal_entries je ON je.id = jel.entry_id
  WHERE public._je_is_posted(je.entry_status)
  GROUP BY ia.organization_id
),
sale_relief AS (
  SELECT
    je.organization_id,
    COALESCE(SUM(jel.credit), 0) AS inventory_credited_on_sales
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.entry_id = je.id
  JOIN inv_acct ia ON ia.account_id = jel.account_id AND ia.organization_id = je.organization_id
  WHERE je.source_type = 'sale'
    AND public._je_is_posted(je.entry_status)
  GROUP BY je.organization_id
),
receipt_capital AS (
  SELECT
    je.organization_id,
    COALESCE(SUM(jel.debit), 0) AS inventory_debited_on_receipts
  FROM journal_entries je
  JOIN journal_entry_lines jel ON jel.entry_id = je.id
  JOIN inv_acct ia ON ia.account_id = jel.account_id AND ia.organization_id = je.organization_id
  WHERE je.source_type IN ('purchase_receipt', 'vendor_bill', 'po_receipt', 'goods_receipt')
    AND public._je_is_posted(je.entry_status)
  GROUP BY je.organization_id
)
SELECT
  g.organization_id,
  g.net_debit_balance,
  g.total_debits,
  g.total_credits,
  g.line_count,
  COALESCE(s.inventory_credited_on_sales, 0) AS sale_inventory_credits,
  COALESCE(r.inventory_debited_on_receipts, 0) AS receipt_inventory_debits,
  COALESCE(r.inventory_debited_on_receipts, 0) - COALESCE(s.inventory_credited_on_sales, 0)
    AS expected_net_from_po_vs_sales
FROM gl_1200 g
LEFT JOIN sale_relief s ON s.organization_id = g.organization_id
LEFT JOIN receipt_capital r ON r.organization_id = g.organization_id;

-- Unposted completed sales (backfill candidates):
-- SELECT s.receipt_no, s.created_at, s.total
-- FROM sales s
-- JOIN org o ON o.id = s.organization_id
-- WHERE s.status = 'completed'
--   AND NOT EXISTS (
--     SELECT 1 FROM journal_entries je
--     WHERE je.organization_id = s.organization_id
--       AND je.source_type = 'sale' AND je.source_id = s.id
--   )
-- ORDER BY s.created_at DESC
-- LIMIT 50;
