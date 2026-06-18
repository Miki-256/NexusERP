"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useCartStore, calcCartTotals } from "@/stores/cart-store";
import { formatCurrency, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentModal } from "./payment-modal";
import { ReceiptPrint } from "./receipt-print";
import { Search, Minus, Plus, Trash2, Pause, Play } from "lucide-react";

type CatalogItem = {
  productId: string;
  variantId: string;
  name: string;
  variantName: string;
  sellPrice: number;
  barcode: string | null;
  stock: number;
};

type Session = {
  id: string;
  opening_float: number;
  opened_at: string;
} | null;

export function PosScreen({
  registerId,
  registerName,
  storeId,
  storeName,
  organizationId,
  currency,
  taxRate,
  taxInclusive,
  orgName,
  receiptFooter,
  catalog,
  openSession: initialSession,
}: {
  registerId: string;
  registerName: string;
  storeId: string;
  storeName: string;
  organizationId: string;
  currency: string;
  taxRate: number;
  taxInclusive: boolean;
  orgName: string;
  receiptFooter: string | null;
  catalog: CatalogItem[];
  openSession: Session;
}) {
  const [session, setSession] = useState(initialSession);
  const [search, setSearch] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [lastSale, setLastSale] = useState<{
    sale: Parameters<typeof ReceiptPrint>[0]["sale"];
    lines: Parameters<typeof ReceiptPrint>[0]["lines"];
    payments: Parameters<typeof ReceiptPrint>[0]["payments"];
  } | null>(null);
  const [openingFloat, setOpeningFloat] = useState("0");
  const [closeCash, setCloseCash] = useState("");
  const [showClose, setShowClose] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const {
    lines,
    cartDiscount,
    heldCarts,
    addLine,
    updateQuantity,
    removeLine,
    setCartDiscount,
    clear,
    hold,
    recall,
  } = useCartStore();

  const { subtotal, tax, total } = calcCartTotals(
    lines,
    cartDiscount,
    taxRate,
    taxInclusive
  );

  const filtered = catalog.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode && p.barcode.includes(search))
  );

  const addProduct = useCallback(
    (item: CatalogItem) => {
      if (!session) return;
      addLine({
        variantId: item.variantId,
        productName: item.name,
        variantName: item.variantName,
        unitPrice: item.sellPrice,
      });
      setSearch("");
      searchRef.current?.focus();
    },
    [session, addLine]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!search) return;
    const byBarcode = catalog.find((p) => p.barcode === search);
    if (byBarcode && search.length >= 4) {
      addProduct(byBarcode);
    }
  }, [search, catalog, addProduct]);

  async function openShift() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("register_sessions")
      .insert({
        register_id: registerId,
        organization_id: organizationId,
        opened_by: user!.id,
        opening_float: parseFloat(openingFloat) || 0,
      })
      .select()
      .single();
    if (!error && data) setSession(data);
  }

  async function closeShift() {
    if (!session) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase
      .from("register_sessions")
      .update({
        closed_at: new Date().toISOString(),
        closed_by: user!.id,
        closing_cash_counted: parseFloat(closeCash) || 0,
      })
      .eq("id", session.id);
    setSession(null);
    setShowClose(false);
  }

  async function onCheckoutComplete(result: {
    receipt_no: string;
    total: number;
    sale_id: string;
  }) {
    const supabase = createClient();
    const { data: sale } = await supabase
      .from("sales")
      .select("*, sale_lines(*), payments(*)")
      .eq("id", result.sale_id)
      .single();

    if (sale) {
      setLastSale({
        sale: {
          receipt_no: sale.receipt_no,
          created_at: sale.created_at,
          subtotal: sale.subtotal,
          tax_amount: sale.tax_amount,
          discount_amount: sale.discount_amount,
          total: sale.total,
          status: sale.status,
        },
        lines: sale.sale_lines as Parameters<typeof ReceiptPrint>[0]["lines"],
        payments: sale.payments as Parameters<typeof ReceiptPrint>[0]["payments"],
      });
    }
    clear();
    setShowPayment(false);
  }

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-900 p-8 text-white">
        <h1 className="text-2xl font-bold">
          {registerName} — {storeName}
        </h1>
        <p>Open a shift to start selling</p>
        <Input
          type="number"
          placeholder="Opening float"
          value={openingFloat}
          onChange={(e) => setOpeningFloat(e.target.value)}
          className="max-w-xs bg-white text-black"
        />
        <Button size="lg" onClick={openShift}>
          Open shift
        </Button>
        <Button asChild variant="outline" className="text-white">
          <Link href="/dashboard">Exit</Link>
        </Button>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex items-center justify-between border-b bg-white px-4 py-2">
        <div>
          <span className="font-bold">{registerName}</span>
          <span className="mx-2 text-muted-foreground">|</span>
          <span className="text-sm">{storeName}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowClose(true)}>
            Close shift
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">Exit</Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col border-r bg-white">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Search or scan barcode (F2)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-base"
                autoFocus
              />
            </div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 overflow-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((item) => (
              <button
                key={item.variantId}
                type="button"
                onClick={() => addProduct(item)}
                className={cn(
                  "flex flex-col rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5",
                  item.stock <= 0 && "opacity-50"
                )}
              >
                <span className="font-medium line-clamp-2">{item.name}</span>
                <span className="mt-1 text-lg font-bold text-primary">
                  {formatCurrency(item.sellPrice, currency)}
                </span>
                <span className="text-xs text-muted-foreground">
                  Stock: {item.stock}
                </span>
              </button>
            ))}
          </div>
        </div>

        <aside className="flex w-full max-w-md flex-col bg-white shadow-lg">
          <div className="flex items-center justify-between border-b p-3">
            <h2 className="font-semibold">Cart ({lines.length})</h2>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={hold} title="Hold">
                <Pause className="h-4 w-4" />
              </Button>
              {heldCarts.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => recall(heldCarts[heldCarts.length - 1].id)}
                >
                  <Play className="mr-1 h-4 w-4" />
                  Recall
                </Button>
              )}
            </div>
          </div>

          <ul className="flex-1 overflow-auto p-2">
            {lines.map((line) => (
              <li
                key={line.variantId}
                className="mb-2 flex items-center gap-2 rounded-md border p-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-sm">
                    {line.productName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(line.unitPrice, currency)} each
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      updateQuantity(line.variantId, line.quantity - 1)
                    }
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-8 text-center font-mono">
                    {line.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      updateQuantity(line.variantId, line.quantity + 1)
                    }
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeLine(line.variantId)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <span className="w-20 text-right text-sm font-medium">
                  {formatCurrency(
                    line.unitPrice * line.quantity - line.discountAmount,
                    currency
                  )}
                </span>
              </li>
            ))}
            {lines.length === 0 && (
              <p className="p-4 text-center text-muted-foreground text-sm">
                Cart is empty
              </p>
            )}
          </ul>

          <div className="border-t p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal, currency)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Tax</span>
              <span>{formatCurrency(tax, currency)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Discount</span>
              <Input
                type="number"
                className="h-8 w-24"
                value={cartDiscount || ""}
                onChange={(e) =>
                  setCartDiscount(parseFloat(e.target.value) || 0)
                }
              />
            </div>
            <div className="flex justify-between text-xl font-bold">
              <span>Total</span>
              <span>{formatCurrency(total, currency)}</span>
            </div>
            <Button
              className="w-full h-14 text-lg"
              size="xl"
              disabled={lines.length === 0}
              onClick={() => setShowPayment(true)}
            >
              Pay {formatCurrency(total, currency)}
            </Button>
          </div>
        </aside>
      </div>

      {showPayment && (
        <PaymentModal
          total={total}
          currency={currency}
          lines={lines}
          cartDiscount={cartDiscount}
          registerId={registerId}
          storeId={storeId}
          sessionId={session.id}
          organizationId={organizationId}
          onClose={() => setShowPayment(false)}
          onComplete={onCheckoutComplete}
        />
      )}

      {showClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 space-y-4">
            <h3 className="font-bold">Close shift</h3>
            <Input
              type="number"
              placeholder="Cash counted"
              value={closeCash}
              onChange={(e) => setCloseCash(e.target.value)}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowClose(false)}>
                Cancel
              </Button>
              <Button onClick={closeShift}>Close shift</Button>
            </div>
          </div>
        </div>
      )}

      {lastSale && (
        <div className="fixed bottom-4 left-4 z-40 max-h-[80vh] overflow-auto rounded-lg border bg-white p-4 shadow-xl">
          <div className="mb-2 flex justify-between">
            <span className="font-medium">Last receipt</span>
            <Button size="sm" variant="ghost" onClick={() => setLastSale(null)}>
              Dismiss
            </Button>
          </div>
          <ReceiptPrint
            sale={lastSale.sale}
            lines={lastSale.lines}
            payments={lastSale.payments}
            orgName={orgName}
            storeName={storeName}
            currency={currency}
            footer={receiptFooter}
          />
        </div>
      )}
    </div>
  );
}
