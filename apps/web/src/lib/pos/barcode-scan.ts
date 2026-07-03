/** Normalize raw camera / scanner input. */
export function normalizeBarcode(raw: string): string {
  return raw.trim().replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
}

function eanChecksum(digits: number[]): boolean {
  const sum = digits.slice(0, -1).reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return check === digits[digits.length - 1];
}

/** Reject partial reads and invalid check digits for retail barcodes. */
export function isValidBarcode(code: string): boolean {
  if (code.length < 4 || code.length > 48) return false;

  if (/^\d{8}$/.test(code)) {
    return eanChecksum(code.split("").map(Number));
  }
  if (/^\d{12}$/.test(code)) {
    return eanChecksum(code.split("").map(Number));
  }
  if (/^\d{13}$/.test(code)) {
    return eanChecksum(code.split("").map(Number));
  }

  // Code 128 / 39 / internal SKUs — require at least one letter or 6+ chars
  if (/^[A-Za-z0-9\-_.+$/%]+$/.test(code) && code.length >= 6) return true;

  return false;
}

/** UPC-A ↔ EAN-13 variants for catalog lookup. */
export function barcodeLookupVariants(code: string): string[] {
  const out = new Set<string>([code]);
  if (/^\d{12}$/.test(code)) out.add(`0${code}`);
  if (/^\d{13}$/.test(code) && code.startsWith("0")) out.add(code.slice(1));
  return [...out];
}

export type ScanConfirmState = {
  code: string;
  count: number;
  firstSeen: number;
};

export const SCAN_CONFIRM_READS = 2;
export const SCAN_READ_WINDOW_MS = 700;
export const SCAN_GLOBAL_GAP_MS = 350;
export const SCAN_SAME_CODE_COOLDOWN_MS = 1800;

export function shouldAcceptScan(
  raw: string,
  state: ScanConfirmState,
  lastAccepted: { code: string; at: number } | null,
  now = Date.now()
): { accept: false; nextState: ScanConfirmState } | { accept: true; code: string; nextState: ScanConfirmState } {
  const code = normalizeBarcode(raw);
  if (!isValidBarcode(code)) {
    return { accept: false, nextState: state };
  }

  if (lastAccepted && now - lastAccepted.at < SCAN_GLOBAL_GAP_MS) {
    return { accept: false, nextState: state };
  }
  if (
    lastAccepted &&
    lastAccepted.code === code &&
    now - lastAccepted.at < SCAN_SAME_CODE_COOLDOWN_MS
  ) {
    return { accept: false, nextState: state };
  }

  let next: ScanConfirmState;
  if (state.code === code && now - state.firstSeen <= SCAN_READ_WINDOW_MS) {
    next = { ...state, count: state.count + 1 };
  } else {
    next = { code, count: 1, firstSeen: now };
  }

  if (next.count < SCAN_CONFIRM_READS) {
    return { accept: false, nextState: next };
  }

  return {
    accept: true,
    code,
    nextState: { code: "", count: 0, firstSeen: 0 },
  };
}
