"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarcodeScannerModal } from "@/components/pos/barcode-scanner-modal";
import { normalizeBarcode, isValidBarcode } from "@/lib/pos/barcode-scan";
import { Camera, ScanBarcode } from "lucide-react";

export function BarcodeCaptureField({
  value,
  onChange,
  disabled,
  onDuplicateFound,
  inputId,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  onDuplicateFound?: (code: string) => void;
  inputId?: string;
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [wedgeHint, setWedgeHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wedgeBuffer = useRef("");
  const wedgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyCode = useCallback(
    (raw: string) => {
      const code = normalizeBarcode(raw);
      if (!isValidBarcode(code)) return false;
      onChange(code);
      onDuplicateFound?.(code);
      return true;
    },
    [onChange, onDuplicateFound]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (disabled || scannerOpen) return;
      const target = e.target as HTMLElement;
      const inField =
        target === inputRef.current ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        wedgeBuffer.current += e.key;
        setWedgeHint(true);
        if (wedgeTimer.current) clearTimeout(wedgeTimer.current);
        wedgeTimer.current = setTimeout(() => {
          wedgeBuffer.current = "";
          setWedgeHint(false);
        }, 100);
      }
      if (e.key === "Enter" && wedgeBuffer.current.length >= 4) {
        const captured = wedgeBuffer.current;
        wedgeBuffer.current = "";
        setWedgeHint(false);
        if (applyCode(captured)) {
          e.preventDefault();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyCode, disabled, scannerOpen]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            id={inputId}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCode(value);
              }
            }}
            placeholder="Scan or type barcode"
            className="pl-9 font-mono"
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => setScannerOpen(true)}
          title="Scan with camera"
        >
          <Camera className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only sm:ml-2">Scan</span>
        </Button>
      </div>
      {wedgeHint && (
        <p className="text-xs text-muted-foreground">USB scanner detected — scanning…</p>
      )}
      {scannerOpen && (
        <BarcodeScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={(code) => {
            const ok = applyCode(code);
            if (ok) {
              setScannerOpen(false);
              return { ok: true, label: code };
            }
            return { ok: false, label: "Invalid barcode" };
          }}
        />
      )}
    </div>
  );
}
