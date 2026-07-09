"use client";

import dynamic from "next/dynamic";
import { LoadingSpinner } from "@/components/ui/loading/loading-spinner";

function ModalFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <LoadingSpinner size="lg" />
    </div>
  );
}

export const PaymentModal = dynamic(
  () => import("./payment-modal").then((m) => m.PaymentModal),
  { ssr: false, loading: ModalFallback }
);

export const BarcodeScannerModal = dynamic(
  () => import("./barcode-scanner-modal").then((m) => m.BarcodeScannerModal),
  { ssr: false, loading: ModalFallback }
);

export const RefundModal = dynamic(
  () => import("./refund-modal").then((m) => m.RefundModal),
  { ssr: false, loading: ModalFallback }
);

export const CloseShiftModal = dynamic(
  () => import("./close-shift-modal").then((m) => m.CloseShiftModal),
  { ssr: false, loading: ModalFallback }
);

export const CustomerLookupModal = dynamic(
  () => import("./customer-lookup-modal").then((m) => m.CustomerLookupModal),
  { ssr: false, loading: ModalFallback }
);

export const ManagerPinModal = dynamic(
  () => import("./manager-pin-modal").then((m) => m.ManagerPinModal),
  { ssr: false, loading: ModalFallback }
);

export const HeldCartPickerModal = dynamic(
  () => import("./held-cart-picker-modal").then((m) => m.HeldCartPickerModal),
  { ssr: false, loading: ModalFallback }
);

export const PosOfflineQueueModal = dynamic(
  () => import("./pos-offline-queue-modal").then((m) => m.PosOfflineQueueModal),
  { ssr: false, loading: ModalFallback }
);

export const ShortcutsHelpModal = dynamic(
  () => import("./shortcuts-help-modal").then((m) => m.ShortcutsHelpModal),
  { ssr: false, loading: ModalFallback }
);

export const PosToolsMenu = dynamic(
  () => import("./pos-tools-menu").then((m) => m.PosToolsMenu),
  { ssr: false }
);

export type { BarcodeScanResult } from "./barcode-scanner-modal";
export type { PosCustomer } from "./customer-lookup-modal";
