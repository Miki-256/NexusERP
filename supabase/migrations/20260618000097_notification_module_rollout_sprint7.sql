-- Sprint 7: Module rollout — inventory, accounting, CRM/helpdesk, security, system health.

-- ---------------------------------------------------------------------------
-- System templates
-- ---------------------------------------------------------------------------
INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'inventory.stock_adjustment.manager', 'in_app', 'Stock adjustment (in-app)',
  'Stock adjusted',
  '{{product_name}} ({{variant_name}}) at {{store_name}}: {{delta}} → {{quantity}} on hand. Reason: {{reason}}',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'inventory.stock_adjustment.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'inventory.out_of_stock.manager', 'in_app', 'Out of stock (in-app)',
  'Out of stock',
  '{{product_name}} ({{variant_name}}) is out of stock at {{store_name}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'inventory.out_of_stock.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'accounting.payment_received.manager', 'in_app', 'Payment received (in-app)',
  'Payment received',
  '{{customer_name}} paid {{amount}} via {{payment_method}}. {{reference}}',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'accounting.payment_received.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'accounting.journal_posted.manager', 'in_app', 'Journal posted (in-app)',
  'Journal entry posted',
  'Entry {{journal_code}} posted: {{memo}}',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'accounting.journal_posted.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'crm.customer_created.manager', 'in_app', 'New customer (in-app)',
  'New customer',
  '{{name}} was added{{#phone}} ({{phone}}){{/phone}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'crm.customer_created.manager' AND channel = 'in_app'
);

-- Plain body without mustache sections (renderer is simple placeholder)
UPDATE notification_templates
SET body_template = 'New customer: {{name}}. Phone: {{phone}}. Email: {{email}}.'
WHERE organization_id IS NULL
  AND code = 'crm.customer_created.manager'
  AND channel = 'in_app';

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'crm.complaint_logged.manager', 'in_app', 'Helpdesk ticket (in-app)',
  'New support ticket',
  '[{{priority}}] {{subject}} — {{customer_name}}',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'crm.complaint_logged.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'security.login_failed.manager', 'in_app', 'Failed login (in-app)',
  'Failed login attempt',
  'Failed login for {{email}} from {{ip_address}}.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'security.login_failed.manager' AND channel = 'in_app'
);

INSERT INTO notification_templates (
  organization_id, code, channel, name, subject_template, body_template, body_format, is_active
)
SELECT NULL, 'system.queue_backlog.manager', 'in_app', 'Notification queue backlog',
  'Queue backlog',
  'Notification backlog: {{queued}} deliveries + {{events_pending}} events pending. Review Communications → Queue.',
  'plain', true
WHERE NOT EXISTS (
  SELECT 1 FROM notification_templates
  WHERE organization_id IS NULL AND code = 'system.queue_backlog.manager' AND channel = 'in_app'
);

-- ---------------------------------------------------------------------------
-- Default rules (extend existing)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_default_notification_rules(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'POS sale — manager in-app', 'pos.sale_completed', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"pos.sale_completed.manager"}'::jsonb,
    10
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'pos.sale_completed'
      AND name = 'POS sale — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'High-value POS sale — owner email', 'pos.sale_completed',
    '[{"field":"payload.total","op":"gt","value":"10000"}]'::jsonb,
    ARRAY['email']::notification_channel[],
    '{"roles":["owner"]}'::jsonb,
    '{"email":"pos.sale_completed.high_value"}'::jsonb,
    20,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'High-value POS sale — owner email'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'Low stock — manager in-app', 'inventory.low_stock', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"inventory.low_stock.manager"}'::jsonb,
    30
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND event_type = 'inventory.low_stock'
      AND name = 'Low stock — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'POS sale — Telegram group', 'pos.sale_completed', '[]'::jsonb,
    ARRAY['telegram']::notification_channel[],
    '{"use_default_chat": true}'::jsonb,
    '{"telegram":"pos.sale_completed.manager"}'::jsonb,
    40,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'POS sale — Telegram group'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Low stock — Telegram group', 'inventory.low_stock', '[]'::jsonb,
    ARRAY['telegram']::notification_channel[],
    '{"use_default_chat": true}'::jsonb,
    '{"telegram":"inventory.low_stock.manager"}'::jsonb,
    50,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Low stock — Telegram group'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Daily sales report — Telegram', 'reports.daily_sales', '[]'::jsonb,
    ARRAY['telegram']::notification_channel[],
    '{"use_default_chat": true}'::jsonb,
    '{"telegram":"reports.daily_sales"}'::jsonb,
    60,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Daily sales report — Telegram'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'POS payment — customer WhatsApp', 'pos.sale_completed',
    '[{"field":"customer_phone","op":"neq","value":""}]'::jsonb,
    ARRAY['whatsapp']::notification_channel[],
    '{"use_customer_phone": true}'::jsonb,
    '{"whatsapp":"pos.payment_confirmation"}'::jsonb,
    70,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'POS payment — customer WhatsApp'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Invoice reminder — customer WhatsApp', 'accounting.invoice_reminder',
    '[{"field":"customer_phone","op":"neq","value":""}]'::jsonb,
    ARRAY['whatsapp']::notification_channel[],
    '{"use_customer_phone": true}'::jsonb,
    '{"whatsapp":"accounting.invoice_reminder"}'::jsonb,
    80,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Invoice reminder — customer WhatsApp'
  );

  -- Sprint 7 rules
  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'Out of stock — manager in-app', 'inventory.out_of_stock', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"inventory.out_of_stock.manager"}'::jsonb,
    90
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Out of stock — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Stock adjustment — manager in-app', 'inventory.stock_adjustment', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"inventory.stock_adjustment.manager"}'::jsonb,
    100,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Stock adjustment — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'Payment received — manager in-app', 'accounting.payment_received', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"accounting.payment_received.manager"}'::jsonb,
    110
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Payment received — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'Journal posted — manager in-app', 'accounting.journal_posted', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"accounting.journal_posted.manager"}'::jsonb,
    120,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Journal posted — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order, is_active
  )
  SELECT p_org_id, 'New customer — manager in-app', 'crm.customer_created', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"crm.customer_created.manager"}'::jsonb,
    130,
    false
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'New customer — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'Helpdesk ticket — manager in-app', 'crm.complaint_logged', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"crm.complaint_logged.manager"}'::jsonb,
    140
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Helpdesk ticket — manager in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'Failed login — owner in-app', 'security.login_failed', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner","manager"]}'::jsonb,
    '{"in_app":"security.login_failed.manager"}'::jsonb,
    150
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Failed login — owner in-app'
  );

  INSERT INTO notification_rules (
    organization_id, name, event_type, conditions, channels, recipient_spec, template_codes, sort_order
  )
  SELECT p_org_id, 'Queue backlog — owner in-app', 'system.queue_backlog', '[]'::jsonb,
    ARRAY['in_app']::notification_channel[],
    '{"roles":["owner"]}'::jsonb,
    '{"in_app":"system.queue_backlog.manager"}'::jsonb,
    160
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_rules
    WHERE organization_id = p_org_id AND name = 'Queue backlog — owner in-app'
  );
END;
$$;

DO $$
DECLARE v_org UUID;
BEGIN
  FOR v_org IN SELECT id FROM organizations LOOP
    PERFORM public.ensure_default_notification_rules(v_org);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Shared: rule-driven event types (Sprint 7+)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notification_rule_driven_event(p_event_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_event_type IN (
    'pos.sale_completed',
    'inventory.low_stock',
    'inventory.out_of_stock',
    'inventory.stock_adjustment',
    'reports.daily_sales',
    'accounting.payment_received',
    'accounting.journal_posted',
    'crm.customer_created',
    'crm.complaint_logged',
    'security.login_failed',
    'system.queue_backlog'
  );
$$;

-- ---------------------------------------------------------------------------
-- Inventory: adjust_inventory → stock_adjustment (+ out_of_stock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_store_id UUID,
  p_variant_id UUID,
  p_delta NUMERIC,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_new_qty NUMERIC;
  v_store_name TEXT;
  v_variant_name TEXT;
  v_product_name TEXT;
  v_adj_id UUID;
BEGIN
  v_user_id := auth.uid();
  SELECT organization_id, name INTO v_org_id, v_store_name FROM stores WHERE id = p_store_id;

  IF NOT public.user_can_manage(v_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT quantity + p_delta INTO v_new_qty
  FROM inventory_levels
  WHERE store_id = p_store_id AND variant_id = p_variant_id
  FOR UPDATE;

  IF v_new_qty IS NULL THEN
    IF p_delta < 0 THEN
      RAISE EXCEPTION 'Insufficient stock for adjustment';
    END IF;
    v_new_qty := p_delta;
    INSERT INTO inventory_levels (store_id, variant_id, organization_id, quantity)
    VALUES (p_store_id, p_variant_id, v_org_id, v_new_qty);
  ELSE
    IF v_new_qty < 0 THEN
      RAISE EXCEPTION 'Adjustment would result in negative stock (%.2f)', v_new_qty;
    END IF;
    UPDATE inventory_levels
    SET quantity = v_new_qty, updated_at = now()
    WHERE store_id = p_store_id AND variant_id = p_variant_id;
  END IF;

  INSERT INTO inventory_adjustments (store_id, variant_id, organization_id, delta, reason, user_id)
  VALUES (p_store_id, p_variant_id, v_org_id, p_delta, p_reason, v_user_id)
  RETURNING id INTO v_adj_id;

  INSERT INTO audit_logs (organization_id, user_id, entity_type, entity_id, action, payload)
  VALUES (v_org_id, v_user_id, 'inventory', p_variant_id, 'adjusted',
    jsonb_build_object('store_id', p_store_id, 'delta', p_delta, 'reason', p_reason));

  SELECT pv.name, p.name INTO v_variant_name, v_product_name
  FROM product_variants pv
  JOIN products p ON p.id = pv.product_id
  WHERE pv.id = p_variant_id;

  PERFORM public.enqueue_notification_event(
    v_org_id,
    'inventory.stock_adjustment',
    'inventory_adjustment',
    v_adj_id,
    jsonb_build_object(
      'store_id', p_store_id,
      'store_name', COALESCE(v_store_name, 'Store'),
      'variant_id', p_variant_id,
      'variant_name', COALESCE(v_variant_name, ''),
      'product_name', COALESCE(v_product_name, ''),
      'delta', p_delta,
      'quantity', v_new_qty,
      'reason', COALESCE(NULLIF(trim(p_reason), ''), 'Adjustment')
    ),
    'stock_adj:' || COALESCE(v_adj_id::text, p_variant_id::text || ':' || p_store_id::text || ':' || extract(epoch from now())::text)
  );

  IF v_new_qty = 0 THEN
    PERFORM public.enqueue_notification_event(
      v_org_id,
      'inventory.out_of_stock',
      'inventory_level',
      p_variant_id,
      jsonb_build_object(
        'store_id', p_store_id,
        'store_name', COALESCE(v_store_name, 'Store'),
        'variant_id', p_variant_id,
        'variant_name', COALESCE(v_variant_name, ''),
        'product_name', COALESCE(v_product_name, ''),
        'quantity', 0
      ),
      'out_of_stock:' || p_variant_id::text || ':' || p_store_id::text || ':' || current_date::text
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_inventory(UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- Low-stock scan: also emit out_of_stock when qty = 0
CREATE OR REPLACE FUNCTION public.scan_low_stock_notification_events(p_limit INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row RECORD;
  v_enqueued INT := 0;
  v_key TEXT;
BEGIN
  FOR v_row IN
    SELECT
      il.organization_id,
      il.store_id,
      s.name AS store_name,
      il.variant_id,
      pv.name AS variant_name,
      p.name AS product_name,
      il.quantity,
      p.reorder_point
    FROM inventory_levels il
    JOIN stores s ON s.id = il.store_id
    JOIN product_variants pv ON pv.id = il.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE p.reorder_point > 0
      AND il.quantity <= p.reorder_point
    ORDER BY il.organization_id, il.store_id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
  LOOP
    v_key := 'low_stock:' || v_row.variant_id::text || ':' || v_row.store_id::text || ':' || current_date::text;

    PERFORM public.enqueue_notification_event(
      v_row.organization_id,
      'inventory.low_stock',
      'inventory_level',
      v_row.variant_id,
      jsonb_build_object(
        'store_id', v_row.store_id,
        'store_name', v_row.store_name,
        'variant_id', v_row.variant_id,
        'variant_name', v_row.variant_name,
        'product_name', v_row.product_name,
        'quantity', v_row.quantity,
        'reorder_point', v_row.reorder_point
      ),
      v_key
    );
    v_enqueued := v_enqueued + 1;

    IF v_row.quantity = 0 THEN
      PERFORM public.enqueue_notification_event(
        v_row.organization_id,
        'inventory.out_of_stock',
        'inventory_level',
        v_row.variant_id,
        jsonb_build_object(
          'store_id', v_row.store_id,
          'store_name', v_row.store_name,
          'variant_id', v_row.variant_id,
          'variant_name', v_row.variant_name,
          'product_name', v_row.product_name,
          'quantity', 0
        ),
        'out_of_stock:' || v_row.variant_id::text || ':' || v_row.store_id::text || ':' || current_date::text
      );
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_enqueued);
END;
$$;

-- ---------------------------------------------------------------------------
-- Accounting: payment received + journal posted
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collect_customer_receivable(
  p_org_id UUID,
  p_customer_id UUID,
  p_amount NUMERIC,
  p_payment_method payment_method,
  p_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_balance NUMERIC;
  v_tx_id UUID;
  v_pay_acct UUID;
  v_customer_name TEXT;
BEGIN
  IF NOT public.user_can_manage(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_payment_method = 'on_account' OR p_payment_method = 'store_credit' THEN
    RAISE EXCEPTION 'Invalid collection method';
  END IF;

  SELECT balance INTO v_balance
  FROM customer_receivables
  WHERE organization_id = p_org_id AND customer_id = p_customer_id
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance owed';
  END IF;

  INSERT INTO receivable_transactions (
    organization_id, customer_id, amount, reason, payment_method, created_by
  ) VALUES (
    p_org_id, p_customer_id, -p_amount,
    COALESCE(NULLIF(trim(p_reference), ''), 'Payment collected'),
    p_payment_method, auth.uid()
  ) RETURNING id INTO v_tx_id;

  UPDATE customer_receivables
  SET balance = balance - p_amount, updated_at = now()
  WHERE organization_id = p_org_id AND customer_id = p_customer_id;

  PERFORM public.ensure_default_accounts(p_org_id);

  v_pay_acct := public.account_id_by_code(p_org_id, public._payment_method_account_code(p_payment_method));

  PERFORM public._post_journal_entry_balanced(
    p_org_id, 'CSH', current_date,
    COALESCE(NULLIF(trim(p_reference), ''), 'AR collection'),
    'receivable_collection', v_tx_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_pay_acct, 'debit', p_amount, 'credit', 0, 'description', 'Payment received'),
      jsonb_build_object('accountId', public.account_id_by_code(p_org_id, '1100'),
        'debit', 0, 'credit', p_amount, 'description', 'Accounts receivable')
    ),
    auth.uid()
  );

  SELECT COALESCE(NULLIF(trim(name), ''), 'Customer') INTO v_customer_name
  FROM customers WHERE id = p_customer_id;

  PERFORM public.enqueue_notification_event(
    p_org_id,
    'accounting.payment_received',
    'receivable_transaction',
    v_tx_id,
    jsonb_build_object(
      'customer_id', p_customer_id,
      'customer_name', v_customer_name,
      'amount', p_amount,
      'payment_method', p_payment_method::text,
      'reference', COALESCE(NULLIF(trim(p_reference), ''), 'Payment collected'),
      'source', 'receivable_collection'
    ),
    'payment_received:ar:' || v_tx_id::text
  );

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.collect_customer_receivable(UUID, UUID, NUMERIC, payment_method, TEXT) TO authenticated;

-- Clean up premature EFM overload if present (134 recreates the extended signature later)
DROP FUNCTION IF EXISTS public.pay_customer_invoice(UUID, payment_method, NUMERIC, DATE, TEXT);

CREATE OR REPLACE FUNCTION public.pay_customer_invoice(
  p_invoice_id UUID,
  p_payment_method payment_method
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_inv customer_invoices%ROWTYPE;
  v_pay_acct UUID;
  v_entry_id UUID;
  v_customer_name TEXT;
BEGIN
  SELECT * INTO v_inv FROM customer_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF NOT public.user_can_manage(v_inv.organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF v_inv.status <> 'posted' THEN RAISE EXCEPTION 'Invoice must be posted first'; END IF;

  v_pay_acct := CASE p_payment_method
    WHEN 'cash' THEN public.account_id_by_code(v_inv.organization_id, '1000')
    WHEN 'bank_transfer' THEN public.account_id_by_code(v_inv.organization_id, '1010')
    WHEN 'mobile_money' THEN public.account_id_by_code(v_inv.organization_id, '1020')
    ELSE public.account_id_by_code(v_inv.organization_id, '1000')
  END;

  v_entry_id := public.post_journal_entry(
    v_inv.organization_id, 'INV', current_date,
    'Payment ' || v_inv.invoice_no, 'invoice_payment', p_invoice_id,
    jsonb_build_array(
      jsonb_build_object('accountId', v_pay_acct, 'debit', v_inv.total, 'credit', 0, 'description', 'Payment received'),
      jsonb_build_object('accountId', public.account_id_by_code(v_inv.organization_id, '1100'),
        'debit', 0, 'credit', v_inv.total, 'description', 'AR cleared')
    )
  );

  UPDATE customer_invoices SET status = 'paid', paid_entry_id = v_entry_id WHERE id = p_invoice_id;

  SELECT COALESCE(NULLIF(trim(name), ''), 'Customer') INTO v_customer_name
  FROM customers WHERE id = v_inv.customer_id;

  PERFORM public.enqueue_notification_event(
    v_inv.organization_id,
    'accounting.payment_received',
    'customer_invoice',
    p_invoice_id,
    jsonb_build_object(
      'customer_id', v_inv.customer_id,
      'customer_name', v_customer_name,
      'amount', v_inv.total,
      'payment_method', p_payment_method::text,
      'reference', v_inv.invoice_no,
      'invoice_id', p_invoice_id,
      'source', 'invoice_payment'
    ),
    'payment_received:inv:' || p_invoice_id::text
  );

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_customer_invoice(UUID, payment_method) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_journal_entry(p_entry_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
  v_journal_code TEXT;
BEGIN
  SELECT * INTO v_entry FROM journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found';
  END IF;
  IF NOT public.user_can_manage(v_entry.organization_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF v_entry.entry_status <> 'draft'::journal_entry_status THEN
    RAISE EXCEPTION 'Only draft entries can be approved';
  END IF;

  PERFORM public._assert_accounting_date_open(v_entry.organization_id, v_entry.entry_date);

  UPDATE journal_entries
  SET entry_status = 'posted'::journal_entry_status
  WHERE id = p_entry_id;

  SELECT code INTO v_journal_code FROM journals WHERE id = v_entry.journal_id;

  PERFORM public.enqueue_notification_event(
    v_entry.organization_id,
    'accounting.journal_posted',
    'journal_entry',
    p_entry_id,
    jsonb_build_object(
      'journal_code', COALESCE(v_journal_code, ''),
      'memo', COALESCE(v_entry.memo, ''),
      'entry_date', v_entry.entry_date,
      'source_type', COALESCE(v_entry.source_type, '')
    ),
    'journal_posted:' || p_entry_id::text
  );

  RETURN p_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_journal_entry(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- CRM / Helpdesk triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notify_customer_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.enqueue_notification_event(
    NEW.organization_id,
    'crm.customer_created',
    'customer',
    NEW.id,
    jsonb_build_object(
      'name', COALESCE(NULLIF(trim(NEW.name), ''), 'Unnamed'),
      'phone', COALESCE(NEW.phone, ''),
      'email', COALESCE(NEW.email, '')
    ),
    'customer_created:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_created ON customers;
CREATE TRIGGER trg_notify_customer_created
  AFTER INSERT ON customers
  FOR EACH ROW
  EXECUTE FUNCTION public._notify_customer_created();

CREATE OR REPLACE FUNCTION public._notify_helpdesk_ticket_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_customer_name TEXT := 'Walk-in / internal';
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(trim(name), ''), 'Customer') INTO v_customer_name
    FROM customers WHERE id = NEW.customer_id;
  END IF;

  PERFORM public.enqueue_notification_event(
    NEW.organization_id,
    'crm.complaint_logged',
    'helpdesk_ticket',
    NEW.id,
    jsonb_build_object(
      'subject', NEW.subject,
      'priority', NEW.priority::text,
      'customer_id', NEW.customer_id,
      'customer_name', v_customer_name,
      'description', COALESCE(left(NEW.description, 200), '')
    ),
    'helpdesk_ticket:' || NEW.id::text
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_helpdesk_ticket_created ON helpdesk_tickets;
CREATE TRIGGER trg_notify_helpdesk_ticket_created
  AFTER INSERT ON helpdesk_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public._notify_helpdesk_ticket_created();

-- ---------------------------------------------------------------------------
-- Security: tenant-scoped failed login enqueue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_security_login_failed_notifications(
  p_email TEXT,
  p_ip_address TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_org UUID;
  v_count INT := 0;
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_hour_bucket TEXT := to_char(date_trunc('hour', now()), 'YYYYMMDDHH24');
BEGIN
  IF v_email = '' THEN
    RETURN jsonb_build_object('enqueued', 0);
  END IF;

  FOR v_org IN
    SELECT DISTINCT om.organization_id
    FROM organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE lower(u.email) = v_email
  LOOP
    PERFORM public.enqueue_notification_event(
      v_org,
      'security.login_failed',
      'security_event',
      NULL,
      jsonb_build_object(
        'email', v_email,
        'ip_address', COALESCE(p_ip_address, 'unknown'),
        'user_agent', COALESCE(left(p_user_agent, 200), '')
      ),
      'login_failed:' || v_org::text || ':' || v_email || ':' || v_hour_bucket
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_security_login_failed_notifications(TEXT, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- System: per-org notification queue backlog scan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.scan_notification_queue_backlog(
  p_delivery_threshold INT DEFAULT 50,
  p_event_threshold INT DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row RECORD;
  v_enqueued INT := 0;
  v_day TEXT := current_date::text;
BEGIN
  FOR v_row IN
    SELECT
      o.id AS organization_id,
      (
        SELECT COUNT(*) FROM notification_deliveries d
        WHERE d.organization_id = o.id
          AND d.status IN ('pending', 'processing', 'failed')
      ) AS queued,
      (
        SELECT COUNT(*) FROM notification_events e
        WHERE e.organization_id = o.id AND e.processed_at IS NULL
      ) AS events_pending
    FROM organizations o
  LOOP
    IF v_row.queued >= GREATEST(1, COALESCE(p_delivery_threshold, 50))
       OR v_row.events_pending >= GREATEST(1, COALESCE(p_event_threshold, 25)) THEN
      PERFORM public.enqueue_notification_event(
        v_row.organization_id,
        'system.queue_backlog',
        'system',
        NULL,
        jsonb_build_object(
          'queued', v_row.queued,
          'events_pending', v_row.events_pending
        ),
        'queue_backlog:' || v_row.organization_id::text || ':' || v_day
      );
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('enqueued', v_enqueued);
END;
$$;

GRANT EXECUTE ON FUNCTION public.scan_notification_queue_backlog(INT, INT) TO service_role;

-- Extend health probe with notification depths
CREATE OR REPLACE FUNCTION public.get_platform_health_probe()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger_pending INT;
  v_webhook_pending INT;
  v_notification_pending INT;
  v_notification_events INT;
BEGIN
  SELECT COUNT(*)::INT INTO v_ledger_pending FROM sale_ledger_post_queue;
  SELECT COUNT(*)::INT INTO v_webhook_pending
  FROM payment_webhook_queue WHERE processed_at IS NULL;
  SELECT COUNT(*)::INT INTO v_notification_pending
  FROM notification_deliveries WHERE status IN ('pending', 'processing', 'failed');
  SELECT COUNT(*)::INT INTO v_notification_events
  FROM notification_events WHERE processed_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'ledger_queue_pending', v_ledger_pending,
    'payment_webhook_queue_pending', v_webhook_pending,
    'notification_queue_depth', v_notification_pending,
    'notification_events_pending', v_notification_events,
    'checked_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_platform_health_probe() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- process_notification_events — rule-driven Sprint 7 events
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_notification_events(p_limit INT DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event RECORD;
  v_template notification_templates%ROWTYPE;
  v_payload JSONB;
  v_subject TEXT;
  v_body TEXT;
  v_email TEXT;
  v_created INT := 0;
  v_processed INT := 0;
  v_email_enabled BOOLEAN;
  v_rule_created INT;
BEGIN
  FOR v_event IN
    SELECT * FROM notification_events
    WHERE processed_at IS NULL
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_payload := COALESCE(v_event.payload, '{}'::jsonb);

    IF public._notification_rule_driven_event(v_event.event_type) THEN
      IF v_event.event_type = 'pos.sale_completed' THEN
        IF to_regprocedure('public._enrich_pos_sale_notification_payload(jsonb,uuid)') IS NOT NULL THEN
          v_payload := public._enrich_pos_sale_notification_payload(v_payload, v_event.organization_id);
        ELSE
          v_payload := v_payload || jsonb_build_object(
            'receipt_no', COALESCE(v_payload->>'receipt_no', ''),
            'total', COALESCE(v_payload->>'total', '0'),
            'customer_name', COALESCE(NULLIF(trim(v_payload->>'customer_name'), ''), 'Walk-in')
          );
        END IF;
        UPDATE notification_events SET payload = v_payload WHERE id = v_event.id;
        v_event.payload := v_payload;
      END IF;
      v_rule_created := public._notification_apply_rules_for_event(v_event.id);
      v_created := v_created + v_rule_created;

    ELSIF v_event.event_type IN ('team.invite_created', 'team.invite') THEN
      SELECT COALESCE((public.get_notification_email_config_internal(v_event.organization_id)->>'is_enabled')::boolean, false)
      INTO v_email_enabled;

      IF v_email_enabled THEN
        v_template := public._resolve_notification_template(v_event.organization_id, 'team.invite', 'email');
        v_email := NULLIF(trim(v_payload->>'email'), '');

        IF v_email IS NOT NULL AND v_template.id IS NOT NULL THEN
          v_subject := public._render_notification_template(v_template.subject_template, v_payload);
          v_body := public._render_notification_template(v_template.body_template, v_payload);

          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            v_event.organization_id, v_event.id, 'email', 'email', v_email,
            v_template.id, v_subject, v_body, v_template.body_format,
            v_event.id::text || ':' || v_email || ':email'
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;

    ELSIF v_event.event_type = 'accounting.invoice_reminder' THEN
      SELECT COALESCE((public.get_notification_email_config_internal(v_event.organization_id)->>'is_enabled')::boolean, false)
      INTO v_email_enabled;

      IF v_email_enabled THEN
        v_template := public._resolve_notification_template(
          v_event.organization_id, 'accounting.invoice_reminder', 'email'
        );
        v_email := NULLIF(trim(v_payload->>'customer_email'), '');

        IF v_email IS NOT NULL AND v_template.id IS NOT NULL THEN
          v_payload := v_payload || jsonb_build_object(
            'total', COALESCE(v_payload->>'total', '0'),
            'days_overdue', COALESCE(v_payload->>'days_overdue', '0')
          );
          v_subject := public._render_notification_template(v_template.subject_template, v_payload);
          v_body := public._render_notification_template(v_template.body_template, v_payload);

          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key, attachments
          ) VALUES (
            v_event.organization_id, v_event.id, 'email', 'email', v_email,
            v_template.id, v_subject, v_body, v_template.body_format,
            v_event.id::text || ':' || v_email || ':email',
            jsonb_build_array(jsonb_build_object(
              'meta', jsonb_build_object('invoice_id', v_payload->>'invoice_id')
            ))
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;

      -- Also apply rules (WhatsApp invoice reminder, etc.)
      v_rule_created := public._notification_apply_rules_for_event(v_event.id);
      v_created := v_created + COALESCE(v_rule_created, 0);
    END IF;

    UPDATE notification_events SET processed_at = now() WHERE id = v_event.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('events_processed', v_processed, 'deliveries_created', v_created);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_notification_events_for_org(
  p_org_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event RECORD;
  v_template notification_templates%ROWTYPE;
  v_payload JSONB;
  v_subject TEXT;
  v_body TEXT;
  v_email TEXT;
  v_created INT := 0;
  v_processed INT := 0;
  v_email_enabled BOOLEAN;
  v_rule_created INT;
BEGIN
  IF NOT public.user_can_manage_communications(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  PERFORM public.ensure_default_notification_rules(p_org_id);
  IF to_regprocedure('public.repair_notification_system_templates()') IS NOT NULL THEN
    PERFORM public.repair_notification_system_templates();
  END IF;

  FOR v_event IN
    SELECT * FROM notification_events
    WHERE organization_id = p_org_id
      AND processed_at IS NULL
    ORDER BY created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_payload := COALESCE(v_event.payload, '{}'::jsonb);

    IF public._notification_rule_driven_event(v_event.event_type) THEN
      IF v_event.event_type = 'pos.sale_completed' THEN
        IF to_regprocedure('public._enrich_pos_sale_notification_payload(jsonb,uuid)') IS NOT NULL THEN
          v_payload := public._enrich_pos_sale_notification_payload(v_payload, v_event.organization_id);
        END IF;
        UPDATE notification_events SET payload = v_payload WHERE id = v_event.id;
        v_event.payload := v_payload;
      END IF;
      v_rule_created := public._notification_apply_rules_for_event(v_event.id);
      v_created := v_created + v_rule_created;

    ELSIF v_event.event_type IN ('team.invite_created', 'team.invite') THEN
      SELECT COALESCE((public.get_notification_email_config_internal(v_event.organization_id)->>'is_enabled')::boolean, false)
      INTO v_email_enabled;

      IF v_email_enabled THEN
        v_template := public._resolve_notification_template(v_event.organization_id, 'team.invite', 'email');
        v_email := NULLIF(trim(v_payload->>'email'), '');

        IF v_email IS NOT NULL AND v_template.id IS NOT NULL THEN
          v_subject := public._render_notification_template(v_template.subject_template, v_payload);
          v_body := public._render_notification_template(v_template.body_template, v_payload);

          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key
          ) VALUES (
            v_event.organization_id, v_event.id, 'email', 'email', v_email,
            v_template.id, v_subject, v_body, v_template.body_format,
            v_event.id::text || ':' || v_email || ':email'
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;

    ELSIF v_event.event_type = 'accounting.invoice_reminder' THEN
      SELECT COALESCE((public.get_notification_email_config_internal(v_event.organization_id)->>'is_enabled')::boolean, false)
      INTO v_email_enabled;

      IF v_email_enabled THEN
        v_template := public._resolve_notification_template(
          v_event.organization_id, 'accounting.invoice_reminder', 'email'
        );
        v_email := NULLIF(trim(v_payload->>'customer_email'), '');

        IF v_email IS NOT NULL AND v_template.id IS NOT NULL THEN
          v_payload := v_payload || jsonb_build_object(
            'total', COALESCE(v_payload->>'total', '0'),
            'days_overdue', COALESCE(v_payload->>'days_overdue', '0')
          );
          v_subject := public._render_notification_template(v_template.subject_template, v_payload);
          v_body := public._render_notification_template(v_template.body_template, v_payload);

          INSERT INTO notification_deliveries (
            organization_id, event_id, channel, recipient_type, recipient_ref,
            template_id, subject, body, body_format, idempotency_key, attachments
          ) VALUES (
            v_event.organization_id, v_event.id, 'email', 'email', v_email,
            v_template.id, v_subject, v_body, v_template.body_format,
            v_event.id::text || ':' || v_email || ':email',
            jsonb_build_array(jsonb_build_object(
              'meta', jsonb_build_object('invoice_id', v_payload->>'invoice_id')
            ))
          ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
          v_created := v_created + 1;
        END IF;
      END IF;

      v_rule_created := public._notification_apply_rules_for_event(v_event.id);
      v_created := v_created + COALESCE(v_rule_created, 0);
    END IF;

    UPDATE notification_events SET processed_at = now() WHERE id = v_event.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('events_processed', v_processed, 'deliveries_created', v_created);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_notification_events(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_notification_events_for_org(UUID, INT) TO authenticated;
