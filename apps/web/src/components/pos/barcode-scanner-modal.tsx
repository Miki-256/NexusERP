"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
import { Button } from "@/components/ui/button";
import {
  shouldAcceptScan,
  type ScanConfirmState,
} from "@/lib/pos/barcode-scan";
import { playScanErrorSound, playScanSuccessSound } from "@/lib/pos/scan-sounds";
import { Camera, CheckCircle2, FlipHorizontal, Loader2, X } from "lucide-react";
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

function pickDefaultDevice(devices: MediaDeviceInfo[]): string | undefined {
  if (devices.length === 0) return undefined;
  const back = devices.find(
    (d) =>
      /back|rear|environment/i.test(d.label) ||
      d.label.toLowerCase().includes("camera 0")
  );
  return back?.deviceId ?? devices[devices.length - 1]?.deviceId ?? devices[0]?.deviceId;
}

export function BarcodeScannerModal({
  onScan,
  onClose,
  initialStream,
}: {
  onScan: (code: string) => BarcodeScanResult;
  onClose: () => void;
  /** Pre-acquired stream from a user tap — required for reliable mobile camera access. */
  initialStream?: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const nativeLoopRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ownsStreamRef = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const confirmStateRef = useRef<ScanConfirmState>({ code: "", count: 0, firstSeen: 0 });
  const lastAcceptedRef = useRef<{ code: string; at: number } | null>(null);
  const acceptingRef = useRef(false);

  const [status, setStatus] = useState<"starting" | "scanning" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [scanCount, setScanCount] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [flash, setFlash] = useState<"success" | "error" | null>(null);

  const stopAll = useCallback(() => {
    if (nativeLoopRef.current != null) {
      cancelAnimationFrame(nativeLoopRef.current);
      nativeLoopRef.current = null;
    }
    controlsRef.current?.stop();
    controlsRef.current = null;
    readerRef.current = null;
    BrowserCodeReader.releaseAllStreams();
    if (ownsStreamRef.current) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    ownsStreamRef.current = false;
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  const flashResult = useCallback((kind: "success" | "error", text: string) => {
    setFlash(kind);
    setLastFeedback({ ok: kind === "success", text });
    setTimeout(() => setFlash(null), 450);
  }, []);

  const processCandidate = useCallback(
    (raw: string) => {
      if (acceptingRef.current) return;

      const decision = shouldAcceptScan(
        raw,
        confirmStateRef.current,
        lastAcceptedRef.current
      );
      confirmStateRef.current = decision.nextState;

      if (!decision.accept) return;

      acceptingRef.current = true;

      const result = onScanRef.current(decision.code);
      lastAcceptedRef.current = { code: decision.code, at: Date.now() };

      if (result.ok) {
        playScanSuccessSound();
        setScanCount((n) => n + 1);
        flashResult("success", result.label ?? decision.code);
      } else {
        playScanErrorSound();
        flashResult("error", `Not found: ${decision.code}`);
      }

      setTimeout(() => {
        acceptingRef.current = false;
      }, 350);
    },
    [flashResult]
  );

  const startNativeDetector = useCallback(
    async (video: HTMLVideoElement) => {
      if (!window.BarcodeDetector) return false;

      try {
        const detector = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"],
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
    async (
      stream: MediaStream,
      available: MediaDeviceInfo[],
      index: number,
      owned: boolean
    ) => {
      stopAll();
      confirmStateRef.current = { code: "", count: 0, firstSeen: 0 };
      lastAcceptedRef.current = null;
      acceptingRef.current = false;
      setStatus("starting");
      setError(null);

      const video = videoRef.current;
      if (!video) return;

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

      const deviceId =
        available[index]?.deviceId ??
        stream.getVideoTracks()[0]?.getSettings()?.deviceId;

      try {
        const controls = deviceId
          ? await reader.decodeFromVideoDevice(deviceId, video, (result) => {
              if (result) processCandidate(result.getText());
            })
          : await reader.decodeFromConstraints(
              { video: { facingMode: { ideal: "environment" } }, audio: false },
              video,
              (result) => {
                if (result) processCandidate(result.getText());
              }
            );

        controlsRef.current = controls;
        setStatus("scanning");
        void startNativeDetector(video);
      } catch (err) {
        setStatus("error");
        const msg = err instanceof Error ? err.message : "Could not start scanner";
        if (/denied|permission|notallowed/i.test(msg)) {
          setError("Camera access blocked. Allow camera for this site, then try again.");
        } else if (/notfound|devices/i.test(msg)) {
          setError("No camera found on this device.");
        } else {
          setError(msg);
        }
      }
    },
    [processCandidate, startNativeDetector, stopAll]
  );

  const requestCameraStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera is not available in this browser. Use HTTPS or type the barcode.");
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  }, []);

  const startCamera = useCallback(
    async (index: number, available: MediaDeviceInfo[]) => {
      try {
        const deviceId = available[index]?.deviceId;
        const stream = await (deviceId
          ? navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: deviceId } },
              audio: false,
            })
          : requestCameraStream());
        ownsStreamRef.current = true;
        await startWithStream(stream, available, index, true);
      } catch (err) {
        setStatus("error");
        const msg = err instanceof Error ? err.message : "Could not open camera";
        if (/denied|permission|notallowed/i.test(msg)) {
          setError("Camera access blocked. Allow camera for this site, then try again.");
        } else if (/notfound|devices/i.test(msg)) {
          setError("No camera found on this device.");
        } else {
          setError(msg);
        }
      }
    },
    [requestCameraStream, startWithStream]
  );

  const devicesRef = useRef<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatus("error");
          setError("Camera is not available in this browser. Use HTTPS or type the barcode.");
          return;
        }

        const list = await BrowserMultiFormatReader.listVideoInputDevices().catch(() => []);
        if (cancelled) return;

        devicesRef.current = list;
        setDevices(list);
        const defaultIndex = Math.max(
          0,
          list.findIndex((d) => d.deviceId === pickDefaultDevice(list))
        );
        setDeviceIndex(defaultIndex);

        if (initialStream) {
          await startWithStream(
            initialStream,
            list,
            defaultIndex >= 0 ? defaultIndex : 0,
            false
          );
          return;
        }

        const stream = await requestCameraStream();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        await startWithStream(stream, list, defaultIndex >= 0 ? defaultIndex : 0, true);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        const msg = e instanceof Error ? e.message : "Could not access camera";
        if (/denied|permission|notallowed/i.test(msg)) {
          setError("Camera access blocked. Allow camera for this site, then try again.");
        } else if (/notfound|devices/i.test(msg)) {
          setError("No camera found on this device.");
        } else {
          setError(msg);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStream]);

  function flipCamera() {
    if (devices.length < 2) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    void startCamera(next, devices);
  }

  function handleClose() {
    stopAll();
    onClose();
  }

  const panelRef = usePosModal(handleClose);

  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-scanner-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="pos-header flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-white" aria-hidden />
            <div>
              <h2 id="pos-scanner-title" className="pos-heading text-lg font-bold text-white">
                Scan items
              </h2>
              {scanCount > 0 && (
                <p className="text-xs text-white/80">{scanCount} added to cart</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="cursor-pointer rounded-lg p-2 text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Close barcode scanner"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            autoPlay
            aria-label="Camera preview for barcode scanning"
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
              <p className="text-sm font-medium">Starting camera…</p>
            </div>
          )}
          {status === "scanning" && (
            <>
              <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
              <p className="pointer-events-none absolute bottom-4 left-0 right-0 px-4 text-center text-xs font-medium text-white/90">
                Hold steady over each barcode · beep confirms add
              </p>
            </>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 p-6 text-center">
              <p className="text-sm text-white/90">{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 p-4">
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
          {devices.length > 1 && status === "scanning" && (
            <Button
              variant="outline"
              className="w-full cursor-pointer gap-2"
              onClick={flipCamera}
            >
              <FlipHorizontal className="h-4 w-4" />
              Switch camera
            </Button>
          )}
          {error && status === "error" && (
            <Button
              variant="default"
              className="w-full cursor-pointer"
              onClick={() => {
                void startCamera(deviceIndex, devices.length > 0 ? devices : devicesRef.current);
              }}
            >
              Try again
            </Button>
          )}
          <p className="text-center text-xs text-slate-500">
            Each barcode is verified twice before adding · same item has a short cooldown
          </p>
          <Button
            variant="default"
            className="pos-btn-primary w-full cursor-pointer"
            onClick={handleClose}
          >
            Done ({scanCount} scanned)
          </Button>
        </div>
      </div>
    </div>
  );
}
