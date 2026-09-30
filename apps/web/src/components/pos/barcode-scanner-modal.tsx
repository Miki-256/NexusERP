"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import {
  shouldAcceptScan,
  type ScanConfirmState,
} from "@/lib/pos/barcode-scan";
import { playScanErrorSound, playScanSuccessSound } from "@/lib/pos/scan-sounds";
import { Camera, CheckCircle2, FlipHorizontal, Loader2, X } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import type { PosCheckoutMode } from "@/lib/pos/pos-preferences";
import { usePosModal } from "./use-pos-modal";

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
    };
  }
}

export type BarcodeScanResult = {
  ok: boolean;
  label?: string;
};

export type BarcodeScanHandler = (
  code: string
) => BarcodeScanResult | Promise<BarcodeScanResult>;

type FacingMode = "environment" | "user";

function facingFromTrack(stream: MediaStream | null | undefined): FacingMode {
  const facing = stream?.getVideoTracks()[0]?.getSettings()?.facingMode;
  return facing === "user" ? "user" : "environment";
}

export function BarcodeScannerModal({
  onScan,
  onClose,
  initialStream,
  checkoutMode = "default",
  cartCount = 0,
  cartTotal = 0,
  currency = "ETB",
  checkoutBusy = false,
  onFastCheckout,
}: {
  onScan: BarcodeScanHandler;
  onClose: () => void;
  /** Pre-acquired stream from a user tap — required for reliable mobile camera access. */
  initialStream?: MediaStream | null;
  checkoutMode?: PosCheckoutMode;
  cartCount?: number;
  cartTotal?: number;
  currency?: string;
  checkoutBusy?: boolean;
  onFastCheckout?: () => void | Promise<void>;
}) {
  const t = useTranslations("pos");
  const tRef = useRef(t);
  tRef.current = t;

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const nativeLoopRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ownsStreamRef = useRef(false);
  const facingModeRef = useRef<FacingMode>("environment");
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const confirmStateRef = useRef<ScanConfirmState>({ code: "", count: 0, firstSeen: 0 });
  const lastAcceptedRef = useRef<{ code: string; at: number } | null>(null);
  const acceptingRef = useRef(false);
  const flippingRef = useRef(false);

  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [scanCount, setScanCount] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);

  const mapCameraError = useCallback((msg: string) => {
    if (/denied|permission|notallowed/i.test(msg)) {
      return tRef.current("cameraAccessBlocked");
    }
    if (/notfound|devices/i.test(msg)) {
      return tRef.current("noCameraFound");
    }
    return msg;
  }, []);

  const stopDecoderOnly = useCallback(() => {
    if (nativeLoopRef.current != null) {
      cancelAnimationFrame(nativeLoopRef.current);
      nativeLoopRef.current = null;
    }
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
  }, []);

  const stopAll = useCallback(() => {
    stopDecoderOnly();
    BrowserCodeReader.releaseAllStreams();
    if (ownsStreamRef.current) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
    ownsStreamRef.current = false;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, [stopDecoderOnly]);

  const flashResult = useCallback((kind: "success" | "error", text: string) => {
    setFlash(kind);
    setLastFeedback({ ok: kind === "success", text });
    setTimeout(() => setFlash(null), 450);
  }, []);

  const checkoutBusyRef = useRef(checkoutBusy);
  checkoutBusyRef.current = checkoutBusy;

  const processCandidate = useCallback(
    (raw: string) => {
      if (acceptingRef.current || checkoutBusyRef.current) return;

      const decision = shouldAcceptScan(
        raw,
        confirmStateRef.current,
        lastAcceptedRef.current
      );
      confirmStateRef.current = decision.nextState;

      if (!decision.accept) return;

      acceptingRef.current = true;
      lastAcceptedRef.current = { code: decision.code, at: Date.now() };

      void (async () => {
        try {
          const result = await onScanRef.current(decision.code);
          if (result.ok) {
            playScanSuccessSound();
            setScanCount((n) => n + 1);
            flashResult("success", result.label ?? decision.code);
          } else {
            playScanErrorSound();
            flashResult("error", tRef.current("notFoundCode", { code: decision.code }));
          }
        } catch {
          playScanErrorSound();
          flashResult("error", tRef.current("notFoundCode", { code: decision.code }));
        } finally {
          setTimeout(() => {
            acceptingRef.current = false;
          }, 350);
        }
      })();
    },
    [flashResult]
  );

  const startNativeDetector = useCallback(
    async (video: HTMLVideoElement) => {
      if (!window.BarcodeDetector) return false;

      try {
        const detector = new window.BarcodeDetector({
          formats: [
            "qr_code",
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "upc_a",
            "upc_e",
          ],
        });

        const tick = async () => {
          if (!videoRef.current) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length > 0 && codes[0].rawValue) {
              processCandidate(codes[0].rawValue);
            }
          } catch {
            /* skip frame */
          }
          nativeLoopRef.current = requestAnimationFrame(() => void tick());
        };

        nativeLoopRef.current = requestAnimationFrame(() => void tick());
        return true;
      } catch {
        return false;
      }
    },
    [processCandidate]
  );

  const startWithStream = useCallback(
    async (stream: MediaStream, owned: boolean) => {
      stopDecoderOnly();
      // Stop prior tracks when swapping cameras so the OS can open the other lens.
      if (streamRef.current && streamRef.current !== stream) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      confirmStateRef.current = { code: "", count: 0, firstSeen: 0 };
      lastAcceptedRef.current = null;
      acceptingRef.current = false;
      setStatus("starting");
      setError(null);

      const video = videoRef.current;
      if (!video) {
        setStatus("error");
        setError(tRef.current("couldNotStartScanner"));
        if (owned) {
          stream.getTracks().forEach((track) => track.stop());
        }
        return;
      }

      const facing = facingFromTrack(stream);
      facingModeRef.current = facing;
      setFacingMode(facing);

      streamRef.current = stream;
      ownsStreamRef.current = owned;
      video.srcObject = stream;

      try {
        await video.play();
      } catch {
        /* autoplay may need user gesture; stream is still attached */
      }

      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      try {
        // Use the stream we already opened — do not re-open via deviceId
        // (that often forces the rear camera and breaks front/rear switching).
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (result) processCandidate(result.getText());
        });

        controlsRef.current = controls;
        setStatus("scanning");
        void startNativeDetector(video);
      } catch (err) {
        setStatus("error");
        const msg = err instanceof Error ? err.message : tRef.current("couldNotStartScanner");
        setError(mapCameraError(msg));
      }
    },
    [processCandidate, startNativeDetector, stopDecoderOnly, mapCameraError]
  );

  const requestCameraStream = useCallback(async (facing: FacingMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(tRef.current("cameraNotAvailableHttps"));
    }

    const attempts: MediaTrackConstraints[] = [
      { facingMode: { exact: facing } },
      { facingMode: { ideal: facing } },
      { facingMode: facing },
    ];

    let lastError: unknown;
    for (const video of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(tRef.current("couldNotOpenCamera"));
  }, []);

  const startCamera = useCallback(
    async (facing: FacingMode) => {
      try {
        setStatus("starting");
        setError(null);
        const stream = await requestCameraStream(facing);
        await startWithStream(stream, true);
      } catch (err) {
        setStatus("error");
        const msg = err instanceof Error ? err.message : tRef.current("couldNotOpenCamera");
        setError(mapCameraError(msg));
      }
    },
    [requestCameraStream, startWithStream, mapCameraError]
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatus("error");
          setError(tRef.current("cameraNotAvailableHttps"));
          return;
        }

        if (initialStream) {
          if (cancelled) return;
          await startWithStream(initialStream, false);
          return;
        }

        const stream = await requestCameraStream("environment");
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        await startWithStream(stream, true);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        const msg = e instanceof Error ? e.message : tRef.current("couldNotAccessCamera");
        setError(mapCameraError(msg));
      }
    }

    void init();
    return () => {
      cancelled = true;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStream]);

  async function flipCamera() {
    if (flippingRef.current || status === "starting") return;
    flippingRef.current = true;
    const next: FacingMode = facingModeRef.current === "environment" ? "user" : "environment";
    try {
      await startCamera(next);
    } finally {
      flippingRef.current = false;
    }
  }

  function handleClose() {
    if (checkoutBusy) return;
    stopAll();
    onClose();
  }

  const panelRef = usePosModal(handleClose, !checkoutBusy);
  const switchLabel =
    facingMode === "environment" ? t("useFrontCamera") : t("useRearCamera");
  const fastestCheckout = checkoutMode === "fastest" && !!onFastCheckout;
  const canFastPay = fastestCheckout && cartCount > 0 && cartTotal > 0 && !checkoutBusy;

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-scanner-title"
        className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl"
      >
        <div className="pos-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-white" aria-hidden />
            <div>
              <h2 id="pos-scanner-title" className="pos-heading text-lg font-bold text-white">
                {t("scanItems")}
              </h2>
              {scanCount > 0 && (
                <p className="text-xs text-white/80">{t("addedToCartCount", { count: scanCount })}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="cursor-pointer rounded-lg p-2 text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label={t("closeBarcodeScanner")}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="relative h-[min(42dvh,16rem)] shrink-0 bg-black sm:h-auto sm:aspect-[4/3]">
          <video
            ref={videoRef}
            className={`h-full w-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""}`}
            muted
            playsInline
            autoPlay
            aria-label={t("cameraPreviewAria")}
          />
          {flash === "success" && (
            <div className="pointer-events-none absolute inset-0 bg-emerald-400/25 transition-opacity" />
          )}
          {flash === "error" && (
            <div className="pointer-events-none absolute inset-0 bg-red-500/25 transition-opacity" />
          )}
          {status === "starting" && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <Loader2 className="h-10 w-10 animate-spin" aria-hidden />
              <p className="text-sm font-medium">{t("startingCamera")}</p>
            </div>
          )}
          {status === "scanning" && (
            <>
              <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
              <p className="pointer-events-none absolute bottom-4 left-0 right-0 px-4 text-center text-xs font-medium text-white/90">
                {t("holdSteadyOverBarcode")}
              </p>
            </>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 p-6 text-center">
              <p className="text-sm text-white/90">{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {lastFeedback && status === "scanning" && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                lastFeedback.ok
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-red-50 text-red-800"
              }`}
            >
              {lastFeedback.ok && <CheckCircle2 className="h-4 w-4 shrink-0" />}
              <span className="truncate">{lastFeedback.text}</span>
            </div>
          )}
          {fastestCheckout && (
            <div className="flex items-baseline justify-between rounded-xl bg-pos-primary-soft-8 px-3 py-2">
              <span className="text-xs font-semibold text-slate-600">
                {t("scannerCartSummary", { count: cartCount })}
              </span>
              <span className="pos-heading text-lg font-bold tabular-nums text-pos-primary">
                {formatCurrency(cartTotal, currency)}
              </span>
            </div>
          )}
          {(status === "scanning" || status === "error") && (
            <Button
              variant="outline"
              className="w-full cursor-pointer gap-2"
              onClick={() => void flipCamera()}
              disabled={checkoutBusy}
            >
              <FlipHorizontal className="h-4 w-4" />
              {switchLabel}
            </Button>
          )}
          {error && status === "error" && (
            <Button
              variant="default"
              className="w-full cursor-pointer"
              onClick={() => {
                void startCamera(facingModeRef.current);
              }}
            >
              {t("tryAgain")}
            </Button>
          )}
          <p className="text-center text-xs text-slate-500">
            {fastestCheckout ? t("scannerFastestHint") : t("barcodeVerifyHint")}
          </p>
          {fastestCheckout && (
            <button
              type="button"
              data-testid="pos-scanner-quick-cash"
              disabled={!canFastPay}
              onClick={() => void onFastCheckout()}
              aria-busy={checkoutBusy}
              className={cn(
                "pos-checkout-btn touch-target flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-xl text-base font-bold text-white",
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              )}
            >
              {checkoutBusy
                ? t("completingSale")
                : `${t("quickCash")} · ${formatCurrency(cartTotal, currency)}`}
            </button>
          )}
          <Button
            variant={fastestCheckout ? "outline" : "default"}
            className={cn(
              "w-full cursor-pointer",
              !fastestCheckout && "pos-btn-primary"
            )}
            onClick={handleClose}
            disabled={checkoutBusy}
          >
            {fastestCheckout ? t("closeScannerKeepCart") : t("doneScanned", { count: scanCount })}
          </Button>
        </div>
      </div>
    </div>
  );
}
