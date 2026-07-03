import { formatCurrency } from "@/lib/utils";

type ReceiptData = {
  orgName: string;
  storeName: string;
  currency: string;
  receiptNo: string;
  createdAt: string;
  lines: {
    product_name: string;
    variant_name: string | null;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
  subtotal: number;
  tax: number;
  discount: number;
  tip?: number;
  total: number;
  payments: { method: string; amount: number; reference?: string | null }[];
  footer: string | null;
};

const ESC = 0x1b;
const GS = 0x1d;

function enc(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function line(text: string): Uint8Array {
  return enc(`${text}\n`);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export function buildEscPosReceipt(data: ReceiptData): Uint8Array {
  const money = (n: number) => formatCurrency(n, data.currency);

  const chunks: Uint8Array[] = [
    new Uint8Array([ESC, 0x40]),
    new Uint8Array([ESC, 0x61, 1]),
    line(data.orgName),
    line(data.storeName),
    line(new Date(data.createdAt).toLocaleString()),
    line(`#${data.receiptNo}`),
    line("--------------------------------"),
    new Uint8Array([ESC, 0x61, 0]),
  ];

  for (const l of data.lines) {
    const name =
      l.variant_name && l.variant_name !== "Default"
        ? `${l.product_name} (${l.variant_name})`
        : l.product_name;
    chunks.push(line(name));
    chunks.push(line(`  ${l.quantity} x ${money(l.unit_price)}  ${money(l.line_total)}`));
  }

  chunks.push(line("--------------------------------"));
  chunks.push(line(`Subtotal: ${money(data.subtotal)}`));
  chunks.push(line(`Tax: ${money(data.tax)}`));
  if (data.discount > 0) {
    chunks.push(line(`Discount: -${money(data.discount)}`));
  }
  if ((data.tip ?? 0) > 0) {
    chunks.push(line(`Tip: ${money(data.tip!)}`));
  }
  chunks.push(new Uint8Array([ESC, 0x45, 1]));
  chunks.push(line(`TOTAL: ${money(data.total)}`));
  chunks.push(new Uint8Array([ESC, 0x45, 0]));

  for (const p of data.payments) {
    chunks.push(
      line(`${p.method.replace(/_/g, " ")}${p.reference ? ` (${p.reference})` : ""}: ${money(p.amount)}`)
    );
  }

  if (data.footer) {
    chunks.push(line(" "));
    chunks.push(new Uint8Array([ESC, 0x61, 1]));
    chunks.push(line(data.footer));
  }

  chunks.push(line(" "));
  chunks.push(new Uint8Array([ESC, 0x61, 1]));
  chunks.push(line("Thank you!"));
  chunks.push(new Uint8Array([GS, 0x56, 0x00]));

  return concat(chunks);
}

export const ESCPOS_URL_KEY = "nexus-escpos-url";
export const ESCPOS_ENABLED_KEY = "nexus-escpos-enabled";

export function getEscPosPrintUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:17832/print";
  return localStorage.getItem(ESCPOS_URL_KEY) || "http://127.0.0.1:17832/print";
}

export function isEscPosEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ESCPOS_ENABLED_KEY) === "1";
}

export async function printEscPosReceipt(data: ReceiptData): Promise<{ ok: boolean; message?: string }> {
  const url = getEscPosPrintUrl();
  const bytes = Uint8Array.from(buildEscPosReceipt(data));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
      mode: "cors",
    });
    if (!res.ok) {
      return { ok: false, message: `Printer bridge returned ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Could not reach ESC/POS bridge",
    };
  }
}
