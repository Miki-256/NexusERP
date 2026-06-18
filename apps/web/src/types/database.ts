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
          opened_by: string;
          opened_at: string;
          opening_float: number;
          closed_at: string | null;
          closed_by: string | null;
          closing_cash_counted: number | null;
          notes: string | null;
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
          created_by: string;
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
        };
        Returns: Json;
      };
      void_sale: {
        Args: { p_sale_id: string; p_reason: string };
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
          p_initial_qty: number;
        };
        Returns: Json;
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
      receive_purchase_order: {
        Args: { p_po_id: string };
        Returns: string;
      };
      pay_vendor_bill: {
        Args: {
          p_bill_id: string;
          p_payment_method: "cash" | "mobile_money" | "bank_transfer";
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
          p_lines: {
            employeeId: string;
            gross: number;
            allowances: number;
            deductions: number;
            tax: number;
          }[];
        };
        Returns: string;
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
