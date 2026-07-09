"use client";

import { useRef } from "react";
import { useModalBodyLock, useModalFocusTrap } from "@/lib/hooks/use-modal-focus-trap";

/** Focus trap + body scroll lock for POS modals. */
export function usePosModal(onClose: () => void, enabled = true) {
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(panelRef, { onClose, enabled });
  useModalBodyLock(enabled);
  return panelRef;
}
