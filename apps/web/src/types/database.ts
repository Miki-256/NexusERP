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
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
