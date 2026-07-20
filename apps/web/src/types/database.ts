export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          currency: string;
          timezone: string;
          tax_rate: number;
          tax_inclusive: boolean;
          receipt_prefix: string;
          receipt_footer: string | null;
          address: string | null;
          tax_id: string | null;
          logo_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["organizations"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["organizations"]["Row"]>;
      };
      organization_members: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          role: "owner" | "manager" | "cashier";
          store_ids: string[] | null;
          is_active: boolean;
          created_at: string;
        };
      };
      department_roles: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          name: string;
          description: string | null;
          app_ids: string[];
          is_system: boolean;
          created_at: string;
        };
      };
      organization_member_department_roles: {
        Row: {
          member_id: string;
          role_id: string;
        };
      };
      organization_member_app_overrides: {
        Row: {
          member_id: string;
          app_id: string;
          access: "grant" | "deny";
        };
      };
      stores: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          address: string | null;
          is_active: boolean;
          created_at: string;
        };
      };
      registers: {
        Row: {
          id: string;
          store_id: string;
          organization_id: string;
          name: string;
          is_active: boolean;
          created_at: string;
        };
      };
      register_sessions: {
        Row: {
          id: string;
          register_id: string;
          organization_id: string;
          opened_by: string | null;
          opened_by_staff_id: string | null;
          closed_by_staff_id: string | null;
          active_staff_id: string | null;
          opened_at: string;
          opening_float: number;
          closed_at: string | null;
          closed_by: string | null;
          closing_cash_counted: number | null;
          notes: string | null;
        };
      };
      pos_staff: {
        Row: {
          id: string;
          organization_id: string;
          display_name: string;
          pin_hash: string;
          role: "cashier" | "manager";
          store_ids: string[] | null;
          is_active: boolean;
          failed_pin_attempts: number;
          pin_locked_until: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      categories: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          sort_order: number;
          created_at: string;
        };
      };
      products: {
        Row: {
          id: string;
          organization_id: string;
          category_id: string | null;
          name: string;
          sku: string | null;
          barcode: string | null;
          sell_price: number;
          cost_price: number;
          tax_rate: number | null;
          image_url: string | null;
          is_active: boolean;
          created_at: string;
        };
      };
      product_variants: {
        Row: {
          id: string;
          product_id: string;
          organization_id: string;
          name: string;
          sku: string | null;
          barcode: string | null;
          sell_price: number | null;
          cost_price: number | null;
          is_active: boolean;
        };
      };
      inventory_levels: {
        Row: {
          id: string;
          store_id: string;
          variant_id: string;
          organization_id: string;
          quantity: number;
        };
      };
      sales: {
        Row: {
          id: string;
          organization_id: string;
          store_id: string;
          register_id: string;
          session_id: string | null;
          receipt_no: string;
          status: "completed" | "voided" | "returned";
          subtotal: number;
          tax_amount: number;
          discount_amount: number;
          total: number;
          customer_name: string | null;
          customer_phone: string | null;
          idempotency_key: string | null;
          void_reason: string | null;
          created_by: string | null;
          pos_staff_id: string | null;
          created_at: string;
        };
      };
      sale_lines: {
        Row: {
          id: string;
          sale_id: string;
          variant_id: string;
          product_name: string;
          variant_name: string | null;
          quantity: number;
          unit_price: number;
          tax_amount: number;
          discount_amount: number;
          line_total: number;
        };
      };
      payments: {
        Row: {
          id: string;
          sale_id: string;
          organization_id: string;
          method: "cash" | "mobile_money" | "bank_transfer";
          amount: number;
          status: "completed" | "pending";
          reference: string | null;
          provider: string | null;
          phone: string | null;
          bank_name: string | null;
          cash_tendered: number | null;
          change_given: number | null;
        };
      };
      staff_invites: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: "owner" | "manager" | "cashier";
          store_ids: string[] | null;
          department_role_ids: string[];
          invited_by: string;
          accepted_at: string | null;
          created_at: string;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          action: string;
          payload: Json;
          created_at: string;
        };
      };
      accounts: {
        Row: {
          id: string;
          organization_id: string;
          code: string;
          name: string;
          type: "asset" | "liability" | "equity" | "income" | "expense";
          is_active: boolean;
          created_at: string;
        };
      };
      expense_categories: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          account_id: string | null;
          created_at: string;
        };
      };
      expenses: {
        Row: {
          id: string;
          organization_id: string;
          store_id: string | null;
          category_id: string | null;
          vendor_name: string | null;
          description: string | null;
          amount: number;
          payment_method: "cash" | "mobile_money" | "bank_transfer";
          expense_date: string;
          journal_entry_id: string | null;
          created_by: string | null;
          created_at: string;
        };
      };
      vendors: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          is_active: boolean;
          created_at: string;
        };
      };
      purchase_orders: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          store_id: string;
          status: "draft" | "ordered" | "received" | "cancelled";
          order_date: string;
          expected_date: string | null;
          total: number;
          notes: string | null;
          received_at: string | null;
          created_by: string | null;
          created_at: string;
        };
      };
      purchase_order_lines: {
        Row: {
          id: string;
          po_id: string;
          organization_id: string;
          variant_id: string;
          product_name: string;
          quantity: number;
          unit_cost: number;
          line_total: number;
        };
      };
      vendor_bills: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          po_id: string | null;
          bill_no: string | null;
          bill_date: string;
          due_date: string | null;
          amount: number;
          status: "open" | "paid";
          journal_entry_id: string | null;
          paid_entry_id: string | null;
          created_at: string;
        };
      };
      customers: {
        Row: {
          id: string;
          organization_id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      opportunities: {
        Row: {
          id: string;
          organization_id: string;
          customer_id: string | null;
          title: string;
          contact_name: string | null;
          contact_phone: string | null;
          stage: "lead" | "qualified" | "proposal" | "won" | "lost";
          expected_value: number;
          probability: number;
          owner_id: string | null;
          notes: string | null;
          closed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      crm_activities: {
        Row: {
          id: string;
          organization_id: string;
          opportunity_id: string | null;
          customer_id: string | null;
          type: "call" | "email" | "meeting" | "note";
          summary: string;
          due_date: string | null;
          done: boolean;
          created_by: string | null;
          created_at: string;
        };
      };
      employees: {
        Row: {
          id: string;
          organization_id: string;
          store_id: string | null;
          user_id: string | null;
          name: string;
          position: string | null;
          email: string | null;
          phone: string | null;
          employment_type: "full_time" | "part_time" | "contract";
          base_salary: number;
          payment_method: "cash" | "mobile_money" | "bank_transfer";
          hire_date: string;
          status: "active" | "on_leave" | "terminated";
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
      };
      payroll_runs: {
        Row: {
          id: string;
          organization_id: string;
          period_start: string;
          period_end: string;
          payment_method: "cash" | "mobile_money" | "bank_transfer";
          status: "draft" | "posted";
          total_gross: number;
          total_deductions: number;
          total_tax: number;
          total_net: number;
          journal_entry_id: string | null;
          created_by: string | null;
          created_at: string;
        };
      };
      payslips: {
        Row: {
          id: string;
          organization_id: string;
          run_id: string;
          employee_id: string;
          gross: number;
          allowances: number;
          deductions: number;
          tax: number;
          net: number;
          created_at: string;
        };
      };
      platform_admins: {
        Row: {
          user_id: string;
          created_at: string;
        };
      };
    };
    Functions: {
      create_organization_with_owner: {
        Args: {
          p_name: string;
          p_currency?: string;
          p_timezone?: string;
          p_tax_rate?: number;
          p_tax_inclusive?: boolean;
          p_store_name?: string;
          p_register_name?: string;
        };
        Returns: string;
      };
      accept_staff_invite: {
        Args: { p_invite_id: string };
        Returns: string;
      };
      complete_sale: {
        Args: {
          p_organization_id: string;
          p_store_id: string;
          p_register_id: string;
          p_session_id: string;
          p_idempotency_key: string;
          p_lines: Json;
          p_discount_amount: number;
          p_customer_name: string | null;
          p_customer_phone: string | null;
          p_payments: Json;
          p_pos_staff_id?: string | null;
          p_pos_session_token?: string | null;
          p_customer_id?: string | null;
          p_promotion_code?: string | null;
          p_tip_amount?: number;
          p_manager_discount_pin?: string | null;
        };
        Returns: Json;
      };
      create_pos_staff: {
        Args: {
          p_organization_id: string;
          p_display_name: string;
          p_pin: string;
          p_role?: "cashier" | "manager";
          p_store_ids?: string[] | null;
        };
        Returns: string;
      };
      reset_pos_staff_pin: {
        Args: { p_staff_id: string; p_pin: string };
        Returns: undefined;
      };
      set_pos_staff_active: {
        Args: { p_staff_id: string; p_active: boolean };
        Returns: undefined;
      };
      verify_pos_staff_pin: {
        Args: { p_register_id: string; p_staff_id: string; p_pin: string };
        Returns: Json;
      };
      get_pos_register_context: {
        Args: { p_register_id: string };
        Returns: Json;
      };
      get_pos_catalog: {
        Args: { p_register_id: string };
        Returns: Json;
      };
      get_open_register_session: {
        Args: { p_register_id: string };
        Returns: Json;
      };
      get_pos_staff_session: {
        Args: { p_token: string };
        Returns: Json;
      };
      open_register_session_staff: {
        Args: {
          p_register_id: string;
          p_session_token: string;
          p_opening_float?: number;
        };
        Returns: Json;
      };
      close_register_session_staff: {
        Args: {
          p_session_id: string;
          p_session_token: string;
          p_closing_cash?: number;
        };
        Returns: undefined;
      };
      open_register_session_manager: {
        Args: {
          p_register_id: string;
          p_organization_id: string;
          p_opening_float?: number;
          p_staff_id?: string | null;
        };
        Returns: Json;
      };
      get_pos_sale_receipt: {
        Args: { p_sale_id: string; p_session_token?: string | null };
        Returns: Json;
      };
      void_sale: {
        Args: { p_sale_id: string; p_reason: string };
        Returns: undefined;
      };
      void_sale_backoffice: {
        Args: {
          p_sale_id: string;
          p_reason: string;
          p_refund_method?: string;
        };
        Returns: undefined;
      };
      adjust_inventory: {
        Args: {
          p_store_id: string;
          p_variant_id: string;
          p_delta: number;
          p_reason: string;
        };
        Returns: undefined;
      };
      list_stock_movements: {
        Args: {
          p_org_id: string;
          p_store_id?: string | null;
          p_variant_id?: string | null;
          p_movement_type?: string | null;
          p_from?: string | null;
          p_to?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      list_inventory_levels_page: {
        Args: {
          p_org_id: string;
          p_store_id: string;
          p_search?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      list_warehouses: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      list_storage_locations: {
        Args: { p_warehouse_id: string; p_parent_id?: string | null };
        Returns: Json;
      };
      upsert_storage_location: {
        Args: {
          p_warehouse_id: string;
          p_code: string;
          p_name: string;
          p_location_type?: string;
          p_parent_id?: string | null;
          p_is_pickable?: boolean;
          p_is_receivable?: boolean;
          p_id?: string | null;
        };
        Returns: string;
      };
      get_product_detail: {
        Args: { p_product_id: string };
        Returns: Json;
      };
      update_product_extended: {
        Args: { p_product_id: string; p_fields: Json };
        Returns: undefined;
      };
      update_org_inventory_settings: {
        Args: { p_org_id: string; p_costing_method: string };
        Returns: undefined;
      };
      upsert_product_variant: {
        Args: {
          p_product_id: string;
          p_name: string;
          p_sku?: string | null;
          p_barcode?: string | null;
          p_sell_price?: number | null;
          p_cost_price?: number | null;
          p_variant_id?: string | null;
        };
        Returns: string;
      };
      upsert_product_barcode: {
        Args: {
          p_variant_id: string;
          p_barcode: string;
          p_barcode_type?: string;
          p_is_primary?: boolean;
          p_id?: string | null;
        };
        Returns: string;
      };
      list_inventory_lots: {
        Args: {
          p_org_id: string;
          p_store_id?: string | null;
          p_variant_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      set_product_lot_tracking: {
        Args: { p_product_id: string; p_track_lots: boolean };
        Returns: undefined;
      };
      place_quality_hold: {
        Args: {
          p_org_id: string;
          p_store_id: string;
          p_variant_id: string;
          p_reason: string;
          p_lot_id?: string | null;
        };
        Returns: string;
      };
      release_quality_hold: { Args: { p_hold_id: string }; Returns: undefined };
      list_quality_holds: {
        Args: { p_org_id: string; p_store_id?: string | null; p_active_only?: boolean };
        Returns: Json;
      };
      create_cycle_count_session: {
        Args: { p_org_id: string; p_store_id: string; p_name: string; p_notes?: string | null };
        Returns: string;
      };
      record_cycle_count_line: {
        Args: {
          p_session_id: string;
          p_variant_id: string;
          p_counted_qty: number;
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      finalize_cycle_count: { Args: { p_session_id: string }; Returns: Json };
      list_cycle_count_sessions: {
        Args: { p_org_id: string; p_store_id?: string | null; p_limit?: number };
        Returns: Json;
      };
      get_cycle_count_session: { Args: { p_session_id: string }; Returns: Json };
      run_mrp: { Args: { p_org_id: string; p_store_id?: string | null }; Returns: Json };
      list_mrp_suggestions: {
        Args: {
          p_org_id: string;
          p_store_id?: string | null;
          p_include_dismissed?: boolean;
        };
        Returns: Json;
      };
      dismiss_mrp_suggestion: { Args: { p_suggestion_id: string }; Returns: undefined };
      create_purchase_requisition: {
        Args: {
          p_org_id: string;
          p_store_id: string;
          p_title: string;
          p_lines: Json;
          p_notes?: string | null;
        };
        Returns: string;
      };
      create_requisition_from_mrp: {
        Args: { p_org_id: string; p_store_id: string; p_suggestion_ids: string[] };
        Returns: string;
      };
      convert_requisition_to_po: { Args: { p_requisition_id: string }; Returns: string };
      list_purchase_requisitions: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      list_location_balances: {
        Args: {
          p_org_id: string;
          p_store_id?: string | null;
          p_location_id?: string | null;
          p_variant_id?: string | null;
          p_limit?: number;
        };
        Returns: Json;
      };
      putaway_stock: {
        Args: {
          p_org_id: string;
          p_store_id: string;
          p_variant_id: string;
          p_from_location_id: string;
          p_to_location_id: string;
          p_quantity: number;
          p_lot_id?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      sync_default_location_balances: {
        Args: { p_org_id: string; p_store_id: string };
        Returns: number;
      };
      create_fulfillment_order: {
        Args: {
          p_org_id: string;
          p_store_id: string;
          p_lines: Json;
          p_ship_to_name?: string | null;
          p_ship_to_phone?: string | null;
          p_ship_to_address?: string | null;
          p_priority?: string;
          p_notes?: string | null;
        };
        Returns: string;
      };
      release_fulfillment_order: { Args: { p_order_id: string }; Returns: undefined };
      pick_fulfillment_line: {
        Args: { p_line_id: string; p_location_id: string; p_quantity: number };
        Returns: undefined;
      };
      complete_fulfillment_pick: { Args: { p_order_id: string }; Returns: undefined };
      pack_fulfillment_order: { Args: { p_order_id: string }; Returns: undefined };
      ship_fulfillment_order: {
        Args: {
          p_order_id: string;
          p_carrier?: string | null;
          p_tracking_number?: string | null;
          p_weight_kg?: number | null;
        };
        Returns: string;
      };
      list_fulfillment_orders: {
        Args: {
          p_org_id: string;
          p_store_id?: string | null;
          p_status?: string | null;
          p_limit?: number;
        };
        Returns: Json;
      };
      get_fulfillment_order: { Args: { p_order_id: string }; Returns: Json };
      resolve_location_by_barcode: {
        Args: { p_org_id: string; p_barcode: string };
        Returns: Json;
      };
      scm_dashboard_stats: {
        Args: { p_org_id: string; p_store_id?: string | null };
        Returns: Json;
      };
      inventory_abc_analysis: {
        Args: { p_org_id: string; p_store_id?: string | null; p_days?: number };
        Returns: Json;
      };
      inventory_valuation_report: {
        Args: { p_org_id: string; p_store_id?: string | null };
        Returns: Json;
      };
      inventory_aging_report: {
        Args: { p_org_id: string; p_store_id?: string | null; p_limit?: number };
        Returns: Json;
      };
      inventory_movement_summary: {
        Args: { p_org_id: string; p_from: string; p_to: string; p_store_id?: string | null };
        Returns: Json;
      };
      capture_inventory_snapshot: {
        Args: { p_org_id: string; p_store_id?: string | null; p_snapshot_date?: string };
        Returns: number;
      };
      run_inventory_forecast: {
        Args: {
          p_org_id: string;
          p_store_id?: string | null;
          p_horizon_days?: number;
          p_history_days?: number;
        };
        Returns: Json;
      };
      list_inventory_forecast: {
        Args: { p_org_id: string; p_run_id?: string | null; p_limit?: number };
        Returns: Json;
      };
      upsert_ecommerce_channel: {
        Args: {
          p_org_id: string;
          p_name: string;
          p_channel_type?: string;
          p_store_id?: string | null;
          p_config?: Json;
          p_id?: string | null;
        };
        Returns: string;
      };
      list_ecommerce_channels: { Args: { p_org_id: string }; Returns: Json };
      upsert_ecommerce_product_mapping: {
        Args: {
          p_channel_id: string;
          p_variant_id: string;
          p_external_sku?: string | null;
          p_external_id?: string | null;
          p_sync_inventory?: boolean;
        };
        Returns: string;
      };
      sync_ecommerce_inventory: { Args: { p_channel_id: string }; Returns: Json };
      dashboard_stats: {
        Args: { p_organization_id: string; p_store_id?: string | null };
        Returns: Json;
      };
      create_product_with_variant: {
        Args: {
          p_organization_id: string;
          p_name: string;
          p_category_id: string | null;
          p_sku: string | null;
          p_barcode: string | null;
          p_sell_price: number;
          p_cost_price: number;
          p_tax_rate: number | null;
          p_store_id: string | null;
          p_initial_qty?: number;
          p_image_url?: string | null;
        };
        Returns: Json;
      };
      update_product_with_variant: {
        Args: {
          p_product_id: string;
          p_name: string;
          p_category_id: string | null;
          p_sku: string | null;
          p_barcode: string | null;
          p_sell_price: number;
          p_cost_price: number;
          p_tax_rate: number | null;
          p_image_url: string | null;
          p_is_active?: boolean;
        };
        Returns: undefined;
      };
      next_receipt_number: {
        Args: { p_store_id: string };
        Returns: string;
      };
      profit_and_loss: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      record_expense: {
        Args: {
          p_org_id: string;
          p_store_id: string | null;
          p_category_id: string | null;
          p_vendor_name: string | null;
          p_description: string | null;
          p_amount: number;
          p_payment_method: "cash" | "mobile_money" | "bank_transfer";
          p_expense_date: string;
        };
        Returns: string;
      };
      trial_balance: {
        Args: { p_org_id: string; p_to?: string };
        Returns: {
          account_code: string;
          account_name: string;
          account_type: "asset" | "liability" | "equity" | "income" | "expense";
          debit: number;
          credit: number;
          balance: number;
        }[];
      };
      list_customer_invoices_page: {
        Args: {
          p_org_id: string;
          p_from?: string | null;
          p_to?: string | null;
          p_status?: string | null;
          p_limit?: number;
          p_offset?: number;
          p_search?: string | null;
        };
        Returns: Json;
      };
      list_vendor_bills_page: {
        Args: {
          p_org_id: string;
          p_from?: string | null;
          p_to?: string | null;
          p_status?: string | null;
          p_limit?: number;
          p_offset?: number;
          p_search?: string | null;
        };
        Returns: Json;
      };
      list_accounts: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      list_accounts_tree: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_account: {
        Args: {
          p_org_id: string;
          p_account_id: string | null;
          p_code: string;
          p_name: string;
          p_type: "asset" | "liability" | "equity" | "income" | "expense";
          p_is_active?: boolean;
          p_parent_account_id?: string | null;
          p_is_postable?: boolean;
          p_sort_order?: number;
        };
        Returns: string;
      };
      approve_journal_entry: {
        Args: { p_entry_id: string };
        Returns: string;
      };
      reverse_journal_entry: {
        Args: {
          p_entry_id: string;
          p_reversal_date?: string | null;
          p_memo?: string | null;
        };
        Returns: string;
      };
      import_opening_balances: {
        Args: {
          p_org_id: string;
          p_date: string;
          p_lines: Json;
          p_memo?: string;
        };
        Returns: string;
      };
      list_journal_entry_attachments: {
        Args: { p_entry_id: string };
        Returns: Json;
      };
      list_journal_entry_audit_log: {
        Args: { p_entry_id: string };
        Returns: Json;
      };
      list_allocation_rules: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      get_customer_statement: {
        Args: {
          p_org_id: string;
          p_customer_id: string;
          p_from?: string | null;
          p_to?: string | null;
        };
        Returns: Json;
      };
      list_customer_open_invoices: {
        Args: {
          p_org_id: string;
          p_customer_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      list_customers_ar_summary: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      pay_customer_invoice: {
        Args: {
          p_invoice_id: string;
          p_payment_method: "cash" | "mobile_money" | "bank_transfer" | "on_account" | "store_credit";
          p_amount?: number | null;
          p_payment_date?: string | null;
          p_reference?: string | null;
        };
        Returns: string;
      };
      apply_credit_to_invoice: {
        Args: {
          p_invoice_id: string;
          p_credit_note_id: string;
          p_amount?: number | null;
        };
        Returns: string;
      };
      list_ar_dunning_policies: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_ar_dunning_policy: {
        Args: {
          p_org_id: string;
          p_policy_id: string | null;
          p_name: string;
          p_is_default?: boolean;
          p_is_active?: boolean;
          p_grace_days?: number;
          p_levels?: Json;
        };
        Returns: string;
      };
      send_invoice_dunning: {
        Args: { p_invoice_id: string; p_level_no?: number | null };
        Returns: string;
      };
      run_ar_dunning_batch: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      set_invoice_collection_status: {
        Args: { p_invoice_id: string; p_status: string };
        Returns: undefined;
      };
      list_ar_collections_queue: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      ensure_default_ar_dunning_policy: {
        Args: { p_org_id: string };
        Returns: string;
      };
      ensure_default_accounts: {
        Args: { p_org_id: string };
        Returns: undefined;
      };
      post_journal_entry: {
        Args: {
          p_org_id: string;
          p_journal_code: string;
          p_date: string;
          p_memo: string | null;
          p_source_type: string | null;
          p_source_id: string | null;
          p_lines: Json;
        };
        Returns: string;
      };
      post_sale_to_ledger: {
        Args: { p_sale_id: string };
        Returns: string | null;
      };
      is_platform_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      admin_list_organizations: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          status: "pending" | "active" | "suspended";
          plan: string;
          currency: string;
          member_count: number;
          created_at: string;
        }[];
      };
      admin_set_org_status: {
        Args: {
          p_org_id: string;
          p_status: "pending" | "active" | "suspended";
        };
        Returns: undefined;
      };
      admin_get_platform_health: {
        Args: Record<string, never>;
        Returns: Json;
      };
      admin_retry_sale_ledger_post: {
        Args: { p_sale_id: string };
        Returns: Json;
      };
      admin_post_unposted_sales_batch: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      admin_platform_security_pulse: {
        Args: Record<string, never>;
        Returns: Json;
      };
      list_pos_store_registers: {
        Args: { p_register_id: string };
        Returns: Json;
      };
      admin_platform_stats: {
        Args: Record<string, never>;
        Returns: {
          org_count: number;
          orgs_active: number;
          orgs_pending: number;
          orgs_suspended: number;
          member_count: number;
          sales_count: number;
          sales_total: number;
          admin_count: number;
        };
      };
      admin_list_platform_admins: {
        Args: Record<string, never>;
        Returns: { user_id: string; email: string; created_at: string }[];
      };
      admin_grant_platform_admin: {
        Args: { p_email: string };
        Returns: undefined;
      };
      admin_revoke_platform_admin: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      admin_import_customers: {
        Args: { p_org_id: string; p_rows: Json };
        Returns: { imported: number; skipped: number };
      };
      admin_import_products: {
        Args: { p_org_id: string; p_rows: Json; p_store_id?: string | null };
        Returns: { imported: number; skipped: number };
      };
      admin_list_stores: {
        Args: { p_org_id: string };
        Returns: { id: string; name: string }[];
      };
      get_my_app_permissions: {
        Args: { p_organization_id?: string | null };
        Returns: Json;
      };
      get_staff_invite_preview: {
        Args: { p_invite_id: string };
        Returns: Json;
      };
      list_my_workspaces: {
        Args: Record<string, never>;
        Returns: Json;
      };
      get_my_workspace: {
        Args: { p_organization_id?: string | null };
        Returns: Json;
      };
      get_my_pending_staff_invite: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      accept_my_pending_staff_invite: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      save_member_permissions: {
        Args: {
          p_member_id: string;
          p_department_role_ids: string[];
          p_overrides?: Json;
        };
        Returns: undefined;
      };
      ensure_org_department_roles: {
        Args: { p_org_id: string };
        Returns: number;
      };
      get_organization_team_members: {
        Args: { p_org_id: string };
        Returns: {
          id: string;
          user_id: string;
          email: string;
          display_name: string;
          role: "owner" | "manager" | "cashier";
          is_active: boolean;
          created_at: string;
        }[];
      };
      update_organization_member: {
        Args: {
          p_member_id: string;
          p_role?: "owner" | "manager" | "cashier";
          p_is_active?: boolean;
        };
        Returns: undefined;
      };
      user_can_manage_hr: {
        Args: { p_org_id: string };
        Returns: boolean;
      };
      my_employee_id: {
        Args: { p_org_id: string };
        Returns: string | null;
      };
      list_hr_employees: {
        Args: {
          p_org_id: string;
          p_search?: string | null;
          p_status?: "active" | "on_leave" | "terminated" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: { items: Json; total_count: number };
      };
      list_timeoff_employees: {
        Args: { p_org_id: string };
        Returns: { id: string; name: string }[];
      };
      list_leave_requests: {
        Args: {
          p_org_id: string;
          p_status?: "pending" | "approved" | "rejected" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: { items: Json; total_count: number };
      };
      list_job_positions: {
        Args: {
          p_org_id: string;
          p_search?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: { items: Json; total_count: number };
      };
      list_job_applicants: {
        Args: {
          p_org_id: string;
          p_status?: "new" | "interview" | "offer" | "hired" | "refused" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: { items: Json; total_count: number };
      };
      submit_leave_request: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_start_date: string;
          p_end_date: string;
          p_reason?: string | null;
          p_leave_type_id?: string | null;
        };
        Returns: string;
      };
      review_leave_request: {
        Args: {
          p_request_id: string;
          p_status: "pending" | "approved" | "rejected";
        };
        Returns: undefined;
      };
      link_employee_to_user: {
        Args: { p_employee_id: string; p_user_id: string | null };
        Returns: undefined;
      };
      list_org_units: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_org_unit: {
        Args: {
          p_org_id: string;
          p_id?: string | null;
          p_parent_id?: string | null;
          p_unit_type?: "company" | "business_unit" | "division" | "region" | "branch" | "department" | "team";
          p_code?: string | null;
          p_name?: string | null;
          p_description?: string | null;
          p_manager_employee_id?: string | null;
          p_sort_order?: number;
        };
        Returns: string;
      };
      get_org_chart: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      ensure_default_hr_org: {
        Args: { p_org_id: string };
        Returns: undefined;
      };
      sync_analytic_departments_to_org: {
        Args: { p_org_id: string };
        Returns: number;
      };
      get_employee_360: {
        Args: { p_employee_id: string };
        Returns: Json;
      };
      save_employee_360: {
        Args: {
          p_employee_id: string;
          p_employee?: Json;
          p_profile?: Json;
          p_dependents?: Json | null;
        };
        Returns: undefined;
      };
      upsert_employee_document: {
        Args: {
          p_employee_id: string;
          p_name: string;
          p_document_type?: string;
          p_url?: string | null;
          p_mime_type?: string | null;
          p_expires_at?: string | null;
          p_id?: string | null;
        };
        Returns: string;
      };
      approve_workflow_step: {
        Args: {
          p_entity_type: string;
          p_entity_id: string;
          p_approved: boolean;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      get_leave_workflow_status: {
        Args: { p_leave_id: string };
        Returns: Json;
      };
      list_job_requisitions: {
        Args: {
          p_org_id: string;
          p_status?: "draft" | "pending_approval" | "approved" | "rejected" | "posted" | "cancelled" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      upsert_job_requisition: {
        Args: {
          p_org_id: string;
          p_id?: string | null;
          p_title?: string | null;
          p_department?: string | null;
          p_org_unit_id?: string | null;
          p_headcount?: number;
          p_employment_type?: "full_time" | "part_time" | "contract";
          p_justification?: string | null;
        };
        Returns: string;
      };
      submit_job_requisition: {
        Args: { p_requisition_id: string };
        Returns: string;
      };
      publish_job_requisition: {
        Args: { p_requisition_id: string };
        Returns: string;
      };
      get_applicant_pipeline: {
        Args: { p_applicant_id: string };
        Returns: Json;
      };
      schedule_applicant_interview: {
        Args: {
          p_applicant_id: string;
          p_scheduled_at: string;
          p_duration_minutes?: number;
          p_interviewer_employee_id?: string | null;
          p_location_or_link?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      save_interview_scorecard: {
        Args: {
          p_interview_id: string;
          p_status?: "scheduled" | "completed" | "cancelled" | "no_show";
          p_scorecard?: Json;
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      upsert_job_offer: {
        Args: {
          p_applicant_id: string;
          p_salary: number;
          p_start_date: string;
          p_employment_type?: "full_time" | "part_time" | "contract";
          p_offer_letter_url?: string | null;
          p_notes?: string | null;
          p_status?: "draft" | "sent" | "accepted" | "declined" | "withdrawn";
          p_id?: string | null;
        };
        Returns: string;
      };
      hire_applicant: {
        Args: {
          p_applicant_id: string;
          p_base_salary?: number | null;
          p_hire_date?: string | null;
          p_org_unit_id?: string | null;
          p_send_erp_invite?: boolean;
          p_invite_role?: "owner" | "manager" | "cashier";
          p_department_role_ids?: string[];
        };
        Returns: Json;
      };
      list_onboarding_tasks: {
        Args: {
          p_org_id: string;
          p_employee_id?: string | null;
          p_status?: "pending" | "in_progress" | "completed" | "skipped" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      update_onboarding_task: {
        Args: {
          p_task_id: string;
          p_status?: "pending" | "in_progress" | "completed" | "skipped";
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      list_leave_types: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      get_employee_leave_balances: {
        Args: { p_org_id: string; p_employee_id?: string | null; p_year?: number | null };
        Returns: Json;
      };
      sync_leave_balances_for_org: {
        Args: { p_org_id: string; p_year?: number | null };
        Returns: number;
      };
      list_holiday_dates: {
        Args: { p_org_id: string; p_year?: number | null };
        Returns: Json;
      };
      upsert_holiday_date: {
        Args: {
          p_org_id: string;
          p_name: string;
          p_holiday_date: string;
          p_is_recurring?: boolean;
          p_id?: string | null;
        };
        Returns: string;
      };
      list_work_shifts: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_work_shift: {
        Args: {
          p_org_id: string;
          p_name: string;
          p_start_time: string;
          p_end_time: string;
          p_break_minutes?: number;
          p_grace_minutes_late?: number;
          p_id?: string | null;
        };
        Returns: string;
      };
      list_shift_assignments: {
        Args: {
          p_org_id: string;
          p_from_date?: string | null;
          p_to_date?: string | null;
          p_employee_id?: string | null;
        };
        Returns: Json;
      };
      assign_employee_shift: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_shift_id: string;
          p_assignment_date: string;
          p_notes?: string | null;
        };
        Returns: string;
      };
      get_my_attendance_status: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      clock_in: {
        Args: {
          p_org_id: string;
          p_method?: "web" | "qr" | "gps" | "manual";
          p_lat?: number | null;
          p_lng?: number | null;
          p_store_id?: string | null;
        };
        Returns: string;
      };
      clock_out: {
        Args: {
          p_org_id: string;
          p_method?: "web" | "qr" | "gps" | "manual";
          p_lat?: number | null;
          p_lng?: number | null;
        };
        Returns: string;
      };
      list_attendance_records: {
        Args: {
          p_org_id: string;
          p_employee_id?: string | null;
          p_from_date?: string | null;
          p_to_date?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      create_purchase_order: {
        Args: {
          p_org_id: string;
          p_vendor_id: string;
          p_store_id: string;
          p_expected_date: string | null;
          p_notes: string | null;
          p_lines: Json;
        };
        Returns: string;
      };
      cancel_purchase_order: {
        Args: {
          p_po_id: string;
          p_reason?: string | null;
        };
        Returns: string;
      };
      receive_purchase_order: {
        Args: { p_po_id: string; p_receipt_lines?: Json | null };
        Returns: string;
      };
      pay_vendor_bill: {
        Args: {
          p_bill_id: string;
          p_payment_method: "cash" | "mobile_money" | "bank_transfer" | "on_account" | "store_credit";
          p_amount?: number | null;
          p_payment_date?: string | null;
          p_reference?: string | null;
          p_payment_run_id?: string | null;
          p_discount_taken?: number | null;
        };
        Returns: string;
      };
      create_vendor_bill: {
        Args: {
          p_org_id: string;
          p_vendor_id: string;
          p_bill_no?: string | null;
          p_bill_date?: string | null;
          p_due_date?: string | null;
          p_memo?: string | null;
          p_lines?: Json;
        };
        Returns: string;
      };
      post_vendor_bill: {
        Args: { p_bill_id: string };
        Returns: string;
      };
      validate_vendor_bill_match: {
        Args: { p_bill_id: string };
        Returns: Json;
      };
      list_vendor_open_bills: {
        Args: {
          p_org_id: string;
          p_vendor_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      list_vendors_ap_summary: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      get_vendor_statement: {
        Args: {
          p_org_id: string;
          p_vendor_id: string;
          p_from?: string | null;
          p_to?: string | null;
        };
        Returns: Json;
      };
      create_payment_run: {
        Args: {
          p_org_id: string;
          p_bill_ids: string[];
          p_payment_method?: "cash" | "mobile_money" | "bank_transfer";
          p_run_date?: string | null;
          p_memo?: string | null;
        };
        Returns: string;
      };
      approve_payment_run: {
        Args: { p_run_id: string };
        Returns: string;
      };
      execute_payment_run: {
        Args: { p_run_id: string };
        Returns: Json;
      };
      list_payment_runs: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      ensure_default_close_checklist: {
        Args: { p_org_id: string };
        Returns: number;
      };
      start_period_close: {
        Args: { p_period_id: string };
        Returns: Json;
      };
      get_period_close_status: {
        Args: { p_period_id: string };
        Returns: Json;
      };
      run_period_close_preflight: {
        Args: { p_period_id: string };
        Returns: Json;
      };
      refresh_period_close_run: {
        Args: { p_run_id: string };
        Returns: Json;
      };
      waive_period_close_task: {
        Args: { p_run_id: string; p_task_code: string; p_note?: string | null };
        Returns: Json;
      };
      lock_period_subledgers: {
        Args: { p_period_id: string };
        Returns: Json;
      };
      list_exchange_rates: {
        Args: { p_org_id: string; p_currency_code?: string | null; p_from?: string | null; p_to?: string | null };
        Returns: Json;
      };
      upsert_exchange_rate: {
        Args: {
          p_org_id: string;
          p_currency_code: string;
          p_rate_date: string;
          p_rate: number;
          p_rate_type?: string | null;
          p_source?: string | null;
        };
        Returns: string;
      };
      get_exchange_rate: {
        Args: { p_org_id: string; p_currency_code: string; p_date?: string | null; p_rate_type?: string | null };
        Returns: Json;
      };
      get_foreign_currency_balances: {
        Args: { p_org_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      preview_fx_revaluation: {
        Args: { p_org_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      run_fx_revaluation: {
        Args: { p_org_id: string; p_as_of?: string | null; p_memo?: string | null };
        Returns: Json;
      };
      list_fx_revaluation_runs: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      reverse_fx_revaluation: {
        Args: { p_run_id: string };
        Returns: string;
      };
      post_foreign_currency_journal: {
        Args: {
          p_org_id: string;
          p_date: string;
          p_memo: string;
          p_currency_code: string;
          p_lines: Json;
          p_exchange_rate?: number | null;
        };
        Returns: string;
      };
      list_intercompany_relationships: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      list_intercompany_transactions: {
        Args: { p_org_id: string; p_status?: string | null; p_limit?: number };
        Returns: Json;
      };
      post_intercompany_invoice: {
        Args: {
          p_org_id: string;
          p_from_org_id: string;
          p_to_org_id: string;
          p_amount: number;
          p_transaction_date?: string | null;
          p_description?: string | null;
        };
        Returns: string;
      };
      get_intercompany_matrix: {
        Args: { p_group_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      preview_consolidation_eliminations: {
        Args: { p_group_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      upsert_consolidation_group: {
        Args: {
          p_org_id: string;
          p_group_id: string | null;
          p_name: string;
          p_member_org_ids: Json;
          p_reporting_currency?: string | null;
          p_elimination_method?: string | null;
        };
        Returns: string;
      };
      get_treasury_cash_position: {
        Args: { p_org_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      get_treasury_liquidity_forecast: {
        Args: { p_org_id: string; p_days?: number; p_as_of?: string | null };
        Returns: Json;
      };
      create_treasury_transfer: {
        Args: {
          p_org_id: string;
          p_from_bank_account_id: string;
          p_to_bank_account_id: string;
          p_amount: number;
          p_transfer_date?: string | null;
          p_reference?: string | null;
          p_memo?: string | null;
        };
        Returns: string;
      };
      list_treasury_transfers: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      update_bank_account_treasury_settings: {
        Args: {
          p_bank_account_id: string;
          p_account_type?: string | null;
          p_target_balance?: number | null;
          p_minimum_balance?: number | null;
        };
        Returns: undefined;
      };
      get_tax_compliance_settings: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      update_tax_compliance_settings: {
        Args: {
          p_org_id: string;
          p_tax_id?: string | null;
          p_einvoice_enabled?: boolean | null;
          p_einvoice_provider?: string | null;
          p_tax_filing_frequency?: string | null;
        };
        Returns: undefined;
      };
      get_vat_liability_report: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      create_tax_return_period: {
        Args: {
          p_org_id: string;
          p_from: string;
          p_to: string;
          p_return_type?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      list_tax_return_periods: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      file_tax_return: {
        Args: { p_return_id: string };
        Returns: undefined;
      };
      submit_einvoice: {
        Args: { p_org_id: string; p_invoice_id: string };
        Returns: string;
      };
      list_einvoice_documents: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      list_invoices_pending_einvoice: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      list_withholding_tax_rules: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_withholding_tax_rule: {
        Args: {
          p_org_id: string;
          p_rule_id: string | null;
          p_name: string;
          p_rate: number;
          p_applies_to?: string | null;
          p_is_active?: boolean | null;
        };
        Returns: string;
      };
      ensure_default_fpa_scenarios: {
        Args: { p_org_id: string };
        Returns: number;
      };
      list_fpa_scenarios: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_fpa_scenario: {
        Args: {
          p_org_id: string;
          p_scenario_id: string | null;
          p_name: string;
          p_scenario_type?: string | null;
          p_revenue_adjustment_pct?: number | null;
          p_expense_adjustment_pct?: number | null;
          p_description?: string | null;
          p_is_active?: boolean | null;
        };
        Returns: string;
      };
      generate_rolling_forecast: {
        Args: {
          p_org_id: string;
          p_scenario_id: string;
          p_horizon_months?: number | null;
          p_as_of?: string | null;
          p_name?: string | null;
          p_budget_id?: string | null;
        };
        Returns: string;
      };
      get_rolling_forecast: {
        Args: { p_forecast_id: string };
        Returns: Json;
      };
      list_rolling_forecasts: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      compare_fpa_scenarios: {
        Args: { p_org_id: string; p_scenario_ids?: Json | null; p_as_of?: string | null };
        Returns: Json;
      };
      get_fpa_dashboard: {
        Args: { p_org_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      list_cost_centers: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_cost_center: {
        Args: {
          p_org_id: string;
          p_cost_center_id: string | null;
          p_code: string;
          p_name: string;
          p_parent_id?: string | null;
          p_analytic_department_id?: string | null;
          p_is_active?: boolean | null;
        };
        Returns: string;
      };
      upsert_project_financials: {
        Args: {
          p_org_id: string;
          p_project_id: string;
          p_project_code?: string | null;
          p_budget_cost?: number | null;
          p_budget_revenue?: number | null;
          p_contract_value?: number | null;
          p_cost_center_id?: string | null;
          p_accounting_status?: string | null;
          p_start_date?: string | null;
          p_end_date?: string | null;
        };
        Returns: string;
      };
      set_project_cost_budget: {
        Args: { p_org_id: string; p_project_id: string; p_lines: Json };
        Returns: number;
      };
      list_projects_job_cost: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      get_project_job_cost: {
        Args: { p_project_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      get_cost_center_summary: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      post_project_cost_allocation: {
        Args: {
          p_org_id: string;
          p_project_id: string;
          p_amount: number;
          p_source_account_id: string;
          p_destination_account_id: string;
          p_allocation_date?: string | null;
          p_cost_category?: string | null;
          p_memo?: string | null;
        };
        Returns: string;
      };
      ensure_default_fa_books: {
        Args: { p_org_id: string };
        Returns: number;
      };
      list_fa_books: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_fa_book: {
        Args: {
          p_org_id: string;
          p_book_id: string | null;
          p_code: string;
          p_name: string;
          p_book_type?: string | null;
          p_posts_to_gl?: boolean | null;
          p_depr_method?: string | null;
          p_is_active?: boolean | null;
        };
        Returns: string;
      };
      upsert_asset_book_profile: {
        Args: {
          p_asset_id: string;
          p_book_id: string;
          p_useful_life_months?: number | null;
          p_salvage_value?: number | null;
          p_depr_method?: string | null;
        };
        Returns: string;
      };
      get_fa_book_comparison: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      ensure_default_executive_layout: {
        Args: { p_org_id: string };
        Returns: string;
      };
      get_executive_dashboard_layout: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_executive_kpi_target: {
        Args: {
          p_org_id: string;
          p_kpi_key: string;
          p_period_from: string;
          p_period_to: string;
          p_target_value: number;
          p_notes?: string | null;
        };
        Returns: string;
      };
      list_executive_kpi_targets: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      get_executive_financial_dashboard: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      get_executive_kpi_drilldown: {
        Args: {
          p_org_id: string;
          p_kpi_key: string;
          p_from: string;
          p_to: string;
          p_limit?: number;
        };
        Returns: Json;
      };
      ensure_default_financial_automation_rules: {
        Args: { p_org_id: string };
        Returns: number;
      };
      list_financial_automation_rules: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_financial_automation_rule: {
        Args: {
          p_org_id: string;
          p_rule_id: string | null;
          p_name: string;
          p_rule_type: string;
          p_config: Json;
          p_is_active?: boolean;
          p_cooldown_hours?: number;
        };
        Returns: string;
      };
      delete_financial_automation_rule: {
        Args: { p_org_id: string; p_rule_id: string };
        Returns: boolean;
      };
      evaluate_financial_automation_rules: {
        Args: { p_org_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      list_financial_scheduled_reports: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_financial_scheduled_report: {
        Args: {
          p_org_id: string;
          p_schedule_id: string | null;
          p_name: string;
          p_report_type: string;
          p_preset: string;
          p_run_at_hour: number;
          p_run_at_minute: number;
          p_timezone: string;
          p_channels: string[];
          p_recipient_spec: Json;
          p_export_format: string;
          p_is_active: boolean;
        };
        Returns: string;
      };
      ensure_default_financial_scheduled_reports: {
        Args: { p_org_id: string };
        Returns: number;
      };
      get_financial_security_settings: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      update_financial_security_settings: {
        Args: {
          p_org_id: string;
          p_je_requires_approval?: boolean | null;
          p_je_dual_approval_enabled?: boolean | null;
          p_je_dual_approval_threshold?: number | null;
          p_ap_dual_approval_enabled?: boolean | null;
          p_ap_dual_approval_threshold?: number | null;
          p_sod_enforcement_enabled?: boolean | null;
        };
        Returns: Json;
      };
      ensure_default_sod_rules: {
        Args: { p_org_id: string };
        Returns: number;
      };
      list_sod_conflict_rules: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_sod_conflict_rule: {
        Args: {
          p_org_id: string;
          p_rule_id: string | null;
          p_name: string;
          p_action_create: string;
          p_action_approve: string;
          p_is_active?: boolean;
          p_severity?: string;
        };
        Returns: string;
      };
      list_pending_financial_approvals: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      get_financial_performance_settings: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      update_financial_performance_settings: {
        Args: {
          p_org_id: string;
          p_financial_cache_enabled?: boolean | null;
          p_financial_cache_ttl_minutes?: number | null;
          p_financial_prefer_read_replica?: boolean | null;
        };
        Returns: Json;
      };
      ensure_default_financial_partition_policies: {
        Args: { p_org_id: string };
        Returns: number;
      };
      list_financial_partition_policies: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_financial_partition_policy: {
        Args: {
          p_org_id: string;
          p_policy_id: string;
          p_is_active?: boolean | null;
          p_retention_months?: number | null;
        };
        Returns: Json;
      };
      fetch_financial_report: {
        Args: {
          p_org_id: string;
          p_report_type: string;
          p_from?: string | null;
          p_to?: string | null;
          p_as_of?: string | null;
          p_mode?: string | null;
          p_force_refresh?: boolean | null;
        };
        Returns: Json;
      };
      invalidate_financial_report_cache: {
        Args: { p_org_id: string; p_report_type?: string | null };
        Returns: number;
      };
      warm_financial_report_cache: {
        Args: { p_org_id: string; p_as_of?: string | null };
        Returns: Json;
      };
      archive_old_journal_entries: {
        Args: {
          p_org_id: string;
          p_before_date: string;
          p_batch_size?: number | null;
          p_dry_run?: boolean | null;
        };
        Returns: Json;
      };
      run_financial_partition_maintenance: {
        Args: { p_org_id: string; p_dry_run?: boolean | null };
        Returns: Json;
      };
      get_financial_performance_dashboard: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      get_financial_ai_settings: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      update_financial_ai_settings: {
        Args: {
          p_org_id: string;
          p_financial_ai_enabled?: boolean | null;
          p_financial_ai_provider?: string | null;
          p_financial_ai_model?: string | null;
          p_financial_ai_retention_days?: number | null;
        };
        Returns: Json;
      };
      purge_financial_ai_history: {
        Args: {
          p_org_id: string;
          p_older_than_days?: number | null;
        };
        Returns: Json;
      };
      run_financial_ai_retention_purge: {
        Args: Record<string, never>;
        Returns: Json;
      };
      list_financial_ai_suggested_prompts: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      build_financial_ai_context: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: Json;
      };
      resolve_financial_ai_question: {
        Args: { p_org_id: string; p_question: string; p_from: string; p_to: string };
        Returns: Json;
      };
      generate_financial_ai_insights: {
        Args: {
          p_org_id: string;
          p_from: string;
          p_to: string;
          p_replace_existing?: boolean | null;
        };
        Returns: Json;
      };
      list_financial_ai_insights: {
        Args: {
          p_org_id: string;
          p_from?: string | null;
          p_to?: string | null;
          p_limit?: number | null;
        };
        Returns: Json;
      };
      list_financial_ai_conversations: {
        Args: { p_org_id: string; p_limit?: number | null };
        Returns: Json;
      };
      create_financial_ai_conversation: {
        Args: {
          p_org_id: string;
          p_title?: string | null;
          p_from?: string | null;
          p_to?: string | null;
        };
        Returns: Json;
      };
      get_financial_ai_conversation: {
        Args: { p_conversation_id: string };
        Returns: Json;
      };
      append_financial_ai_message: {
        Args: {
          p_conversation_id: string;
          p_role: string;
          p_content: string;
          p_metadata?: Json | null;
        };
        Returns: Json;
      };
      delete_financial_ai_conversation: {
        Args: { p_conversation_id: string };
        Returns: boolean;
      };
      get_financial_shell_preferences: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      update_financial_shell_preferences: {
        Args: {
          p_org_id: string;
          p_default_area?: string | null;
          p_density?: string | null;
          p_pinned_tabs?: Json | null;
          p_show_launchpad?: boolean | null;
        };
        Returns: Json;
      };
      list_financial_launchpad_tiles: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      get_fixed_asset_book_detail: {
        Args: { p_asset_id: string };
        Returns: Json;
      };
      run_depreciation_batch: {
        Args: { p_org_id: string; p_through_date?: string | null; p_book_id?: string | null };
        Returns: Json;
      };
      upsert_tax_code: {
        Args: {
          p_org_id: string;
          p_tax_code_id: string | null;
          p_code: string;
          p_name: string;
          p_rate: number;
          p_is_active?: boolean | null;
          p_tax_type?: string | null;
          p_jurisdiction?: string | null;
          p_is_recoverable?: boolean | null;
        };
        Returns: string;
      };
      customer_summary: {
        Args: { p_org_id: string };
        Returns: {
          customer_id: string;
          name: string | null;
          phone: string | null;
          email: string | null;
          total_spent: number;
          order_count: number;
          last_order: string | null;
        }[];
      };
      set_opportunity_stage: {
        Args: {
          p_opp_id: string;
          p_stage: "lead" | "qualified" | "proposal" | "won" | "lost";
        };
        Returns: undefined;
      };
      run_payroll: {
        Args: {
          p_org_id: string;
          p_period_start: string;
          p_period_end: string;
          p_payment_method: "cash" | "mobile_money" | "bank_transfer";
          p_lines?: Json | null;
        };
        Returns: string;
      };
      calculate_payroll_preview: {
        Args: { p_org_id: string; p_employee_ids?: string[] | null };
        Returns: Json;
      };
      list_pay_components: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      create_payroll_draft: {
        Args: {
          p_org_id: string;
          p_period_start: string;
          p_period_end: string;
          p_payment_method?: "cash" | "mobile_money" | "bank_transfer";
          p_employee_ids?: string[] | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      submit_payroll_run: {
        Args: { p_run_id: string };
        Returns: string;
      };
      approve_payroll_run: {
        Args: { p_run_id: string };
        Returns: undefined;
      };
      post_payroll_run: {
        Args: { p_run_id: string };
        Returns: string;
      };
      cancel_payroll_run: {
        Args: { p_run_id: string };
        Returns: undefined;
      };
      get_payroll_run_detail: {
        Args: { p_run_id: string };
        Returns: Json;
      };
      list_my_payslips: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      export_payroll_bank_file: {
        Args: { p_run_id: string };
        Returns: string;
      };
      list_skills: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_skill: {
        Args: {
          p_org_id: string;
          p_code: string;
          p_name: string;
          p_category?: string | null;
          p_skill_id?: string | null;
        };
        Returns: string;
      };
      list_employee_skills: {
        Args: { p_org_id: string; p_employee_id: string };
        Returns: Json;
      };
      set_employee_skill: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_skill_id: string;
          p_proficiency?: "beginner" | "intermediate" | "advanced" | "expert";
          p_years_experience?: number | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      list_performance_goals: {
        Args: {
          p_org_id: string;
          p_employee_id?: string | null;
          p_status?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      create_performance_goal: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_title: string;
          p_description?: string | null;
          p_target_date?: string | null;
          p_weight?: number;
          p_cycle_id?: string | null;
        };
        Returns: string;
      };
      update_goal_progress: {
        Args: { p_goal_id: string; p_progress_pct: number; p_status?: string | null };
        Returns: undefined;
      };
      list_my_goals: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      list_review_cycles: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      create_review_cycle: {
        Args: {
          p_org_id: string;
          p_name: string;
          p_period_start: string;
          p_period_end: string;
        };
        Returns: string;
      };
      activate_review_cycle: {
        Args: { p_cycle_id: string };
        Returns: number;
      };
      list_performance_reviews: {
        Args: {
          p_org_id: string;
          p_cycle_id?: string | null;
          p_status?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      get_performance_review: {
        Args: { p_review_id: string };
        Returns: Json;
      };
      list_my_performance_reviews: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      save_performance_review_self: {
        Args: {
          p_review_id: string;
          p_self_comments?: string | null;
          p_ratings?: Json | null;
        };
        Returns: undefined;
      };
      save_performance_review_manager: {
        Args: {
          p_review_id: string;
          p_manager_comments?: string | null;
          p_overall_rating?: number | null;
          p_ratings?: Json | null;
        };
        Returns: undefined;
      };
      submit_performance_review: {
        Args: { p_review_id: string; p_as_manager?: boolean };
        Returns: string;
      };
      approve_performance_review: {
        Args: { p_review_id: string };
        Returns: undefined;
      };
      list_training_courses: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_training_course: {
        Args: {
          p_org_id: string;
          p_code: string;
          p_name: string;
          p_provider?: string | null;
          p_duration_hours?: number | null;
          p_mandatory?: boolean;
          p_course_id?: string | null;
        };
        Returns: string;
      };
      list_employee_training: {
        Args: {
          p_org_id: string;
          p_employee_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      record_employee_training: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_course_id: string;
          p_status?: "planned" | "in_progress" | "completed" | "cancelled";
          p_started_at?: string | null;
          p_completed_at?: string | null;
          p_score?: number | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      list_my_training: {
        Args: { p_org_id: string; p_limit?: number };
        Returns: Json;
      };
      list_benefit_plans: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      list_benefit_enrollments: {
        Args: {
          p_org_id: string;
          p_employee_id?: string | null;
          p_status?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      enroll_employee_benefit: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_plan_id: string;
          p_coverage_level?: string | null;
          p_effective_date?: string | null;
          p_status?: "pending" | "active" | "waived" | "terminated";
        };
        Returns: string;
      };
      update_benefit_enrollment: {
        Args: {
          p_enrollment_id: string;
          p_status: "pending" | "active" | "waived" | "terminated";
          p_end_date?: string | null;
        };
        Returns: undefined;
      };
      list_my_benefits: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      list_hr_policies: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      list_pending_policies: {
        Args: { p_org_id: string; p_employee_id?: string | null };
        Returns: Json;
      };
      acknowledge_hr_policy: {
        Args: { p_policy_id: string };
        Returns: string;
      };
      list_policy_acknowledgements: {
        Args: {
          p_org_id: string;
          p_policy_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      list_expiring_compliance_items: {
        Args: { p_org_id: string; p_days_ahead?: number };
        Returns: Json;
      };
      scan_hr_compliance_alerts: {
        Args: { p_org_id: string; p_days_ahead?: number };
        Returns: number;
      };
      get_hr_workforce_dashboard: {
        Args: { p_org_id: string; p_from?: string | null; p_to?: string | null };
        Returns: Json;
      };
      start_employee_offboarding: {
        Args: { p_employee_id: string; p_last_working_date?: string | null; p_notes?: string | null };
        Returns: Json;
      };
      list_offboarding_tasks: {
        Args: {
          p_org_id: string;
          p_employee_id?: string | null;
          p_status?: "pending" | "in_progress" | "completed" | "skipped" | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      update_offboarding_task: {
        Args: {
          p_task_id: string;
          p_status?: "pending" | "in_progress" | "completed" | "skipped" | null;
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      finalize_employee_offboarding: {
        Args: { p_employee_id: string };
        Returns: undefined;
      };
      list_my_offboarding_tasks: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      schedule_probation_review: {
        Args: { p_employee_id: string; p_probation_end_date: string };
        Returns: string;
      };
      list_probation_reviews: {
        Args: {
          p_org_id: string;
          p_status?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      complete_probation_review: {
        Args: {
          p_review_id: string;
          p_outcome: "pending" | "passed" | "extended" | "failed";
          p_notes?: string | null;
          p_extended_until?: string | null;
        };
        Returns: undefined;
      };
      create_employment_contract: {
        Args: {
          p_org_id: string;
          p_employee_id: string;
          p_title?: string | null;
          p_start_date?: string | null;
          p_end_date?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      renew_employment_contract: {
        Args: { p_contract_id: string; p_new_end_date: string; p_notes?: string | null };
        Returns: string;
      };
      list_employment_contracts: {
        Args: {
          p_org_id: string;
          p_employee_id?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      list_contracts_due_for_renewal: {
        Args: { p_org_id: string; p_days_ahead?: number };
        Returns: Json;
      };
      scan_lifecycle_alerts: {
        Args: { p_org_id: string; p_days_ahead?: number };
        Returns: number;
      };
      list_hr_payroll_gl_mappings: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_hr_payroll_gl_mapping: {
        Args: {
          p_org_id: string;
          p_mapping_key: string;
          p_gl_account_code: string;
          p_description?: string | null;
        };
        Returns: string;
      };
      export_hr_employees_csv: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      export_hr_leave_csv: {
        Args: { p_org_id: string; p_from?: string | null; p_to?: string | null };
        Returns: Json;
      };
      export_hr_payroll_csv: {
        Args: { p_org_id: string; p_from?: string | null; p_to?: string | null };
        Returns: Json;
      };
      export_hr_attendance_csv: {
        Args: { p_org_id: string; p_from?: string | null; p_to?: string | null };
        Returns: Json;
      };
      list_hr_webhook_endpoints: {
        Args: { p_org_id: string };
        Returns: Json;
      };
      upsert_hr_webhook_endpoint: {
        Args: {
          p_org_id: string;
          p_name: string;
          p_url: string;
          p_events?: string[] | null;
          p_secret?: string | null;
          p_is_active?: boolean | null;
          p_id?: string | null;
        };
        Returns: string;
      };
      delete_hr_webhook_endpoint: {
        Args: { p_id: string };
        Returns: undefined;
      };
      list_hr_webhook_deliveries: {
        Args: { p_org_id: string; p_limit?: number; p_offset?: number };
        Returns: Json;
      };
      claim_hr_webhook_batch: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      mark_hr_webhook_delivery: {
        Args: { p_queue_id: string; p_success: boolean; p_error?: string | null };
        Returns: undefined;
      };
      balance_sheet: {
        Args: { p_org_id: string; p_to?: string };
        Returns: {
          as_of: string;
          assets: { code: string; name: string; amount: number }[];
          total_assets: number;
          liabilities: { code: string; name: string; amount: number }[];
          total_liabilities: number;
          equity: { code: string; name: string; amount: number }[];
          current_earnings: number;
          total_equity: number;
          total_liabilities_and_equity: number;
          balanced: boolean;
        };
      };
      cash_flow: {
        Args: { p_org_id: string; p_from: string; p_to: string };
        Returns: {
          from: string;
          to: string;
          opening_cash: number;
          inflows: number;
          outflows: number;
          net_change: number;
          closing_cash: number;
          by_source: { source: string; net: number }[];
        };
      };
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
