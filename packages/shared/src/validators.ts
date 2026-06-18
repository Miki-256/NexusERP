import { z } from "zod";

export const memberRoleSchema = z.enum(["owner", "manager", "cashier"]);

export const paymentMethodSchema = z.enum([
  "cash",
  "mobile_money",
  "bank_transfer",
]);

export const mobileMoneyProviderSchema = z.enum([
  "mpesa",
  "telebirr",
  "cbe_birr",
  "m_pesa",
  "other",
]);

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1).max(100),
});

export const organizationSetupSchema = z.object({
  name: z.string().min(1).max(200),
  currency: z.string().length(3).default("ETB"),
  timezone: z.string().default("Africa/Addis_Ababa"),
  taxRate: z.coerce.number().min(0).max(100).default(15),
  taxInclusive: z.boolean().default(false),
});

export const storeSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional(),
});

export const registerSchema = z.object({
  name: z.string().min(1).max(100),
  storeId: z.string().uuid(),
});

export const categorySchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.coerce.number().int().default(0),
});

export const productSchema = z.object({
  name: z.string().min(1).max(200),
  categoryId: z.string().uuid().optional().nullable(),
  sku: z.string().max(50).optional().nullable(),
  barcode: z.string().max(50).optional().nullable(),
  sellPrice: z.coerce.number().min(0),
  costPrice: z.coerce.number().min(0).default(0),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
});

export const inventoryAdjustmentSchema = z.object({
  storeId: z.string().uuid(),
  variantId: z.string().uuid(),
  delta: z.coerce.number(),
  reason: z.string().min(1).max(500),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: memberRoleSchema,
  storeIds: z.array(z.string().uuid()).optional(),
});

export const openSessionSchema = z.object({
  registerId: z.string().uuid(),
  openingFloat: z.coerce.number().min(0).default(0),
});

export const closeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  closingCashCounted: z.coerce.number().min(0),
  notes: z.string().max(500).optional(),
});

export const cartLineSchema = z.object({
  variantId: z.string().uuid(),
  productName: z.string(),
  variantName: z.string().optional().nullable(),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  discountAmount: z.number().min(0).default(0),
});

export const paymentInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("cash"),
    amount: z.number().positive(),
    cashTendered: z.number().min(0),
  }),
  z.object({
    method: z.literal("mobile_money"),
    amount: z.number().positive(),
    provider: mobileMoneyProviderSchema,
    reference: z.string().min(1).max(100),
    phone: z.string().max(20).optional(),
  }),
  z.object({
    method: z.literal("bank_transfer"),
    amount: z.number().positive(),
    reference: z.string().min(1).max(100),
    bankName: z.string().max(100).optional(),
  }),
]);

export const checkoutSchema = z.object({
  registerId: z.string().uuid(),
  sessionId: z.string().uuid(),
  storeId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  lines: z.array(cartLineSchema).min(1),
  discountAmount: z.number().min(0).default(0),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(20).optional(),
  payments: z.array(paymentInputSchema).min(1),
});

export const voidSaleSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().min(1).max(500),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type PaymentInput = z.infer<typeof paymentInputSchema>;
