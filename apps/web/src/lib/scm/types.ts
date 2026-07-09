export type StockMovementType =
  | "adjustment"
  | "warehouse_transfer"
  | "purchase_receipt"
  | "sale_shipment"
  | "sale_return"
  | "sale_void"
  | "production_issue"
  | "production_receipt"
  | "initial_stock"
  | "import_receipt"
  | "bulk_receive"
  | "cycle_count_adjustment"
  | "location_transfer"
  | "fulfillment_shipment";

export type StockMovementLineRow = {
  id: string;
  store_id: string;
  store_name: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  quantity_delta: number;
  quantity_before: number;
  quantity_after: number;
  unit_cost: number | null;
  line_notes: string | null;
};

export type StockMovementRow = {
  id: string;
  movement_type: StockMovementType;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  user_id: string | null;
  created_at: string;
  lines: StockMovementLineRow[];
};

export type InventoryLevelPageRow = {
  id: string;
  store_id: string;
  variant_id: string;
  quantity: number;
  updated_at: string;
  variant_name: string;
  variant_barcode: string | null;
  product_name: string;
  sell_price: number;
  reorder_point: number;
};

export const INVENTORY_PAGE_SIZE = 50;

export type ProductLifecycleStatus = "draft" | "active" | "discontinued" | "obsolete";
export type WarehouseType = "store" | "distribution" | "manufacturing" | "transit";
export type StorageLocationType = "zone" | "aisle" | "rack" | "shelf" | "bin" | "staging" | "dock";
export type InventoryCostingMethod = "moving_average" | "fifo" | "standard";
export type BarcodeType = "ean13" | "upc" | "code128" | "qr" | "internal" | "other";

export type WarehouseRow = {
  id: string;
  store_id: string | null;
  code: string;
  name: string;
  warehouse_type: WarehouseType;
  address: string | null;
  is_active: boolean;
  location_count: number;
};

export type StorageLocationRow = {
  id: string;
  parent_id: string | null;
  location_type: StorageLocationType;
  code: string;
  name: string;
  is_pickable: boolean;
  is_receivable: boolean;
  is_active: boolean;
  sort_order: number;
};

export type ProductExtendedFields = {
  lifecycle_status: ProductLifecycleStatus;
  base_uom_code: string;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  hs_code: string | null;
  country_of_origin: string | null;
  shelf_life_days: number | null;
  description: string | null;
};

export type InventoryLotRow = {
  id: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  lot_number: string;
  expiry_date: string | null;
  status: string;
  total_qty: number;
  created_at: string;
};

export type QualityHoldRow = {
  id: string;
  store_id: string;
  store_name: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  lot_id: string | null;
  lot_number: string | null;
  status: string;
  reason: string;
  created_at: string;
  released_at: string | null;
};

export type CycleCountSessionRow = {
  id: string;
  store_id: string;
  store_name: string;
  name: string;
  status: string;
  notes: string | null;
  created_at: string;
  finalized_at: string | null;
  line_count: number;
  counted_lines: number;
};

export type CycleCountLineRow = {
  id: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  expected_qty: number;
  counted_qty: number | null;
  variance_qty: number | null;
  notes: string | null;
};

export type MrpSuggestionRow = {
  id: string;
  store_id: string;
  store_name: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  source: string;
  on_hand: number;
  reorder_point: number;
  suggested_qty: number;
  preferred_vendor_id: string | null;
  vendor_name: string | null;
  is_dismissed: boolean;
  created_at: string;
};

export type PurchaseRequisitionRow = {
  id: string;
  store_id: string;
  store_name: string;
  title: string;
  status: string;
  notes: string | null;
  po_id: string | null;
  created_at: string;
  line_count: number;
};

export type LocationBalanceRow = {
  id: string;
  store_id: string;
  store_name: string;
  location_id: string;
  location_code: string;
  location_name: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  lot_id: string | null;
  lot_number: string | null;
  quantity: number;
  updated_at: string;
};

export type FulfillmentOrderRow = {
  id: string;
  order_no: string;
  store_id: string;
  store_name: string;
  status: string;
  priority: string;
  ship_to_name: string | null;
  ship_to_address: string | null;
  created_at: string;
  released_at: string | null;
  shipped_at: string | null;
  line_count: number;
  total_qty: number;
};

export type FulfillmentOrderLineRow = {
  id: string;
  variant_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_picked: number;
  quantity_shipped: number;
  pick_location_id: string | null;
  pick_location_code: string | null;
  line_notes: string | null;
};

export type ScmDashboardStats = {
  total_skus: number;
  total_units: number;
  total_value: number;
  low_stock_count: number;
  open_fulfillment_orders: number;
  movements_today: number;
  dead_stock_count: number;
};

export type AbcAnalysisRow = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  units_sold: number;
  revenue: number;
  abc_class: string;
};

export type InventoryForecastLineRow = {
  id: string;
  store_id: string;
  store_name: string;
  variant_id: string;
  product_name: string;
  avg_daily_demand: number;
  forecast_qty: number;
  on_hand: number;
  days_of_supply: number | null;
  abc_class: string | null;
};

export type EcommerceChannelRow = {
  id: string;
  name: string;
  channel_type: string;
  store_id: string | null;
  store_name: string | null;
  is_active: boolean;
  last_sync_at: string | null;
  mapping_count: number;
};
