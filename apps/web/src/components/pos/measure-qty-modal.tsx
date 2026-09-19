"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { usePosModal } from "@/components/pos/use-pos-modal";
import type { PosCatalogItem, PosSaleUom } from "@/components/pos/product-card";
import {
  defaultSaleUom,
  isMeasuredUomCode,
  qtyStepForUom,
} from "@/lib/pos/stock-utils";
import { X } from "lucide-react";

export type MeasureQtyConfirm = {
  qty: number;
  uom: PosSaleUom;
};

export function MeasureQtyModal({
  item,
  currency,
  onClose,
  onConfirm,
}: {
  item: PosCatalogItem;
  currency: string;
  onClose: () => void;
  onConfirm: (result: MeasureQtyConfirm) => void;
}) {
  const t = useTranslations("pos");
  const tCommon = useTranslations("common");
  const panelRef = usePosModal(onClose);
  const inputRef = useRef<HTMLInputElement>(null);

  const measuredUoms = useMemo(() => {
    const all = item.saleUoms?.length
      ? item.saleUoms
      : [{ code: "ea", name: "Each", factor: 1, isBase: true }];
    const measured = all.filter((u) => isMeasuredUomCode(u.code));
    return measured.length ? measured : all;
  }, [item.saleUoms]);

  const initial = defaultSaleUom(item);
  const [uomCode, setUomCode] = useState(
    (measuredUoms.find((u) => u.code.toLowerCase() === initial.code.toLowerCase()) ??
      measuredUoms[0]
    ).code.toLowerCase()
  );
  const [qty, setQty] = useState("");

  const selected =
    measuredUoms.find((u) => u.code.toLowerCase() === uomCode) ?? measuredUoms[0];
  const factor = Number(selected?.factor) || 1;
  const unitPrice = Math.round(item.sellPrice * factor * 100) / 100;
  const qtyNum = parseFloat(qty);
  const lineTotal =
    Number.isFinite(qtyNum) && qtyNum > 0 ? unitPrice * qtyNum : 0;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) return;
    onConfirm({ qty: qtyNum, uom: selected });
  }

  return (
    <div
      className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="measure-qty-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="measure-qty-title" className="truncate text-lg font-bold text-slate-900">
              {t("measureQtyTitle")}
            </h2>
            <p className="truncate text-sm text-slate-600">{item.name}</p>
            <p className="mt-1 text-xs text-slate-500">{t("measureQtyHint")}</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={tCommon("cancel")}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="measure-uom">{t("unitOfMeasure")}</Label>
            <select
              id="measure-uom"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
              value={uomCode}
              onChange={(e) => setUomCode(e.target.value)}
            >
              {measuredUoms.map((u) => (
                <option key={u.code} value={u.code.toLowerCase()}>
                  {u.name} ({u.code})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="measure-qty">
              {t("measureAmount", { uom: selected?.code ?? "uom" })}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                id="measure-qty"
                type="number"
                min={qtyStepForUom(selected?.code, factor)}
                step={qtyStepForUom(selected?.code, factor)}
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={t("measureAmountPlaceholder")}
                className="h-12 text-lg font-mono font-bold"
                required
              />
              <span className="shrink-0 rounded-lg bg-slate-100 px-3 py-3 text-sm font-semibold uppercase text-slate-700">
                {selected?.code}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {t("measureUnitPrice", {
                price: formatCurrency(unitPrice, currency),
                uom: selected?.code ?? "",
              })}
              {lineTotal > 0
                ? ` · ${t("measureLineTotal", { total: formatCurrency(lineTotal, currency) })}`
                : ""}
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" className="flex-1" disabled={!(qtyNum > 0)}>
              {t("addMeasuredQty")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
