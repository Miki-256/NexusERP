/**
 * NexusERP Finance Process Validation Workshop — PowerPoint builder.
 * Evidence-based: only documents features confirmed in codebase / ACCOUNTING_PROCESS.md.
 */
import PptxGenJS from "pptxgenjs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../docs/presentations");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "NexusERP-Finance-Process-Validation-Workshop.pptx");

const C = {
  navy: "0B1F33",
  blue: "1B4F72",
  teal: "0E6655",
  accent: "1A5276",
  light: "F4F7FA",
  white: "FFFFFF",
  dark: "1C2833",
  muted: "5D6D7E",
  line: "D5D8DC",
  warn: "922B21",
  ok: "196F3D",
  soft: "EBF5FB",
  softGreen: "E8F8F5",
  softAmber: "FEF9E7",
};

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "NexusERP Finance Transformation";
pptx.title = "NexusERP Finance Process Validation Workshop";
pptx.subject = "Evidence-based accounting process walkthrough for professional accountants";

function addFooter(slide, n, total) {
  slide.addText("NexusERP  ·  Finance Process Validation Workshop  ·  Confidential", {
    x: 0.4,
    y: 7.15,
    w: 10.5,
    h: 0.25,
    fontSize: 10,
    color: C.muted,
    fontFace: "Calibri",
  });
  slide.addText(`${n} / ${total}`, {
    x: 11.5,
    y: 7.15,
    w: 1.4,
    h: 0.25,
    fontSize: 10,
    color: C.muted,
    align: "right",
    fontFace: "Calibri",
  });
}

function titleBar(slide, title, subtitle) {
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 1.05,
    fill: { color: C.navy },
  });
  slide.addText(title, {
    x: 0.45,
    y: 0.18,
    w: 12.4,
    h: 0.45,
    fontSize: 26,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.45,
      y: 0.62,
      w: 12.4,
      h: 0.3,
      fontSize: 13,
      color: "AED6F1",
      fontFace: "Calibri",
    });
  }
}

function sectionSlide(num, title, blurb, total) {
  const s = pptx.addSlide();
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: C.navy },
  });
  s.addText(`SECTION ${num}`, {
    x: 0.8,
    y: 2.2,
    w: 11,
    h: 0.35,
    fontSize: 14,
    color: "5DADE2",
    fontFace: "Calibri",
    bold: true,
  });
  s.addText(title, {
    x: 0.8,
    y: 2.7,
    w: 11.5,
    h: 0.8,
    fontSize: 40,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
  s.addText(blurb, {
    x: 0.8,
    y: 3.7,
    w: 10.5,
    h: 1.2,
    fontSize: 18,
    color: "D4E6F1",
    fontFace: "Calibri",
  });
  addFooter(s, num, total);
  return s;
}

function contentSlide(title, subtitle, total, n) {
  const s = pptx.addSlide();
  s.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: C.light },
  });
  titleBar(s, title, subtitle);
  addFooter(s, n, total);
  return s;
}

function bullets(slide, items, opts = {}) {
  const x = opts.x ?? 0.5;
  const y = opts.y ?? 1.3;
  const w = opts.w ?? 12.3;
  slide.addText(
    items.map((t) => ({
      text: t,
      options: { bullet: true, breakLine: true },
    })),
    {
      x,
      y,
      w,
      h: opts.h ?? 5.4,
      fontSize: opts.fontSize ?? 15,
      color: C.dark,
      fontFace: "Calibri",
      paraSpacing: 8,
    }
  );
}

function twoCol(slide, leftTitle, leftItems, rightTitle, rightItems, y0 = 1.25) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y: y0,
    w: 6.05,
    h: 5.4,
    fill: { color: C.white },
    shadow: { type: "outer", color: "000000", blur: 4, opacity: 0.08 },
    rectRadius: 0.08,
  });
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 6.85,
    y: y0,
    w: 6.05,
    h: 5.4,
    fill: { color: C.white },
    shadow: { type: "outer", color: "000000", blur: 4, opacity: 0.08 },
    rectRadius: 0.08,
  });
  slide.addText(leftTitle, {
    x: 0.65,
    y: y0 + 0.2,
    w: 5.5,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.blue,
    fontFace: "Calibri",
  });
  slide.addText(rightTitle, {
    x: 7.1,
    y: y0 + 0.2,
    w: 5.5,
    h: 0.35,
    fontSize: 16,
    bold: true,
    color: C.teal,
    fontFace: "Calibri",
  });
  slide.addText(
    leftItems.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
    {
      x: 0.65,
      y: y0 + 0.65,
      w: 5.5,
      h: 4.5,
      fontSize: 13,
      color: C.dark,
      fontFace: "Calibri",
      paraSpacing: 6,
    }
  );
  slide.addText(
    rightItems.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
    {
      x: 7.1,
      y: y0 + 0.65,
      w: 5.5,
      h: 4.5,
      fontSize: 13,
      color: C.dark,
      fontFace: "Calibri",
      paraSpacing: 6,
    }
  );
}

function tableSlide(slide, headers, rows, opts = {}) {
  const x = opts.x ?? 0.4;
  const y = opts.y ?? 1.3;
  const w = opts.w ?? 12.5;
  const colW = opts.colW ?? headers.map(() => w / headers.length);
  slide.addTable(
    [
      headers.map((h) => ({
        text: h,
        options: { bold: true, color: C.white, fill: { color: C.navy }, align: "center" },
      })),
      ...rows.map((r, i) =>
        r.map((c) => ({
          text: String(c),
          options: {
            fill: { color: i % 2 === 0 ? C.white : C.soft },
            color: C.dark,
            align: opts.align ?? "left",
            fontSize: opts.fontSize ?? 11,
          },
        }))
      ),
    ],
    {
      x,
      y,
      w,
      colW,
      border: [{ type: "solid", pt: 0.5, color: C.line }],
      fontFace: "Calibri",
      fontSize: opts.fontSize ?? 11,
      valign: "middle",
    }
  );
}

function reviewBox(slide, questions, y = 5.55) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y,
    w: 12.5,
    h: 1.4,
    fill: { color: C.softAmber },
    rectRadius: 0.06,
  });
  slide.addText("ACCOUNTING TEAM REVIEW", {
    x: 0.6,
    y: y + 0.12,
    w: 12,
    h: 0.28,
    fontSize: 12,
    bold: true,
    color: "7D6608",
    fontFace: "Calibri",
  });
  slide.addText(
    questions.map((q) => ({ text: q, options: { bullet: true, breakLine: true } })),
    {
      x: 0.6,
      y: y + 0.4,
      w: 12,
      h: 0.9,
      fontSize: 12,
      color: C.dark,
      fontFace: "Calibri",
    }
  );
}

// Build slides — track total at end by generating then renumbering is hard;
// use planned TOTAL.
const TOTAL = 46;
let n = 0;
const next = () => ++n;

// ========== 1. TITLE ==========
{
  const s = pptx.addSlide();
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: C.navy } });
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 6.6, w: 13.333, h: 0.9, fill: { color: C.blue } });
  s.addText("FINANCE PROCESS VALIDATION WORKSHOP", {
    x: 0.8,
    y: 2.0,
    w: 11.5,
    h: 0.45,
    fontSize: 16,
    color: "5DADE2",
    bold: true,
    fontFace: "Calibri",
  });
  s.addText("NexusERP", {
    x: 0.8,
    y: 2.5,
    w: 11.5,
    h: 0.7,
    fontSize: 48,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
  s.addText("End-to-End Accounting Lifecycle — Implementation Evidence Review", {
    x: 0.8,
    y: 3.35,
    w: 11,
    h: 0.45,
    fontSize: 20,
    color: "D4E6F1",
    fontFace: "Calibri",
  });
  s.addText(
    "For Controllers · CFOs · Auditors · Finance Managers · Professional Accountants\nNot a sales pitch — a process validation workshop based on the live product codebase",
    {
      x: 0.8,
      y: 4.2,
      w: 11,
      h: 0.9,
      fontSize: 14,
      color: "A9CCE3",
      fontFace: "Calibri",
    }
  );
  s.addText("Demonstration company: ABC Trading LLC  ·  Wholesale & Retail", {
    x: 0.8,
    y: 6.8,
    w: 11,
    h: 0.35,
    fontSize: 14,
    color: C.white,
    fontFace: "Calibri",
  });
  next();
}

// ========== 2. AGENDA ==========
{
  const s = contentSlide("Workshop Agenda", "What we will validate together today", TOTAL, next());
  const items = [
    ["01", "Principles & scope — evidence-only"],
    ["02", "ERP finance architecture"],
    ["03", "ABC Trading LLC scenario"],
    ["04", "Company setup & master data"],
    ["05", "Purchasing → Inventory → AP"],
    ["06", "Sales / POS / Formal invoicing"],
    ["07", "Expenses · Banking · Payroll · Assets"],
    ["08", "Tax · Close · Statements · Controls"],
    ["09", "Strengths · Gaps · Review questions"],
  ];
  items.forEach((row, i) => {
    const col = i < 5 ? 0 : 1;
    const rowI = i % 5;
    const x = 0.5 + col * 6.4;
    const y = 1.35 + rowI * 0.95;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 6.1,
      h: 0.8,
      fill: { color: C.white },
      rectRadius: 0.06,
    });
    s.addText(row[0], {
      x: x + 0.2,
      y: y + 0.2,
      w: 0.7,
      h: 0.4,
      fontSize: 18,
      bold: true,
      color: C.blue,
      fontFace: "Calibri",
    });
    s.addText(row[1], {
      x: x + 1.0,
      y: y + 0.22,
      w: 4.8,
      h: 0.4,
      fontSize: 15,
      color: C.dark,
      fontFace: "Calibri",
    });
  });
}

// ========== 3. PRINCIPLES ==========
{
  const s = contentSlide(
    "Workshop Principles",
    "How this deck was built — and what it is not",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Evidence standard",
    [
      "Every process shown maps to a live screen, RPC, or migration",
      "Primary sources: ACCOUNTING_PROCESS.md, EFM / SCM / HCM wave docs, financial shell config, SQL migrations",
      "Automatic journals use seeded COA codes (1000–6510)",
      "Async POS → GL via sale_ledger_post_queue + process-queue cron",
    ],
    "Explicitly out of scope (not invented)",
    [
      "Sales quotations / sales orders / delivery notes as commercial docs — not implemented",
      "CRM → invoice conversion — not implemented",
      "Inventory adjustments / manufacturing → GL — stock only, no JE",
      "IAS 7 full O/I/F cash-flow sections — simplified cash movement CF exists",
      "Real PEPPOL / national e-invoice networks — stub only",
    ]
  );
}

// ========== 4. SECTION ARCH ==========
sectionSlide(
  "02",
  "ERP Finance Overview",
  "Double-entry GL hub with operational modules posting through controlled RPCs",
  TOTAL
);
next();

// ========== 5. ARCHITECTURE ==========
{
  const s = contentSlide(
    "Architecture at a Glance",
    "Business apps → operational tables → balanced journal entries → statements",
    TOTAL,
    next()
  );
  const boxes = [
    { t: "Ops Apps", d: "POS · Invoicing\nPurchasing · Expenses\nHR Payroll", c: C.soft },
    { t: "Subledgers", d: "sales · invoices\nvendor_bills\nexpenses · receivables", c: C.softGreen },
    { t: "General Ledger", d: "accounts\njournal_entries\njournal_entry_lines", c: C.softAmber },
    { t: "Statements", d: "TB · P&L · BS\nCash flow · Aging\nExecutive dashboard", c: "F5EEF8" },
  ];
  boxes.forEach((b, i) => {
    const x = 0.45 + i * 3.2;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.5,
      w: 2.95,
      h: 2.6,
      fill: { color: b.c },
      rectRadius: 0.08,
    });
    s.addText(b.t, {
      x: x + 0.15,
      y: 1.7,
      w: 2.65,
      h: 0.4,
      fontSize: 16,
      bold: true,
      color: C.navy,
      fontFace: "Calibri",
    });
    s.addText(b.d, {
      x: x + 0.15,
      y: 2.3,
      w: 2.65,
      h: 1.5,
      fontSize: 13,
      color: C.dark,
      fontFace: "Calibri",
    });
    if (i < 3) {
      s.addText("→", {
        x: x + 2.85,
        y: 2.5,
        w: 0.4,
        h: 0.4,
        fontSize: 22,
        color: C.blue,
        fontFace: "Calibri",
      });
    }
  });
  s.addText(
    "Two reporting modes: Operational (sales/expense rollups on /reports) vs GL mode (posted journal lines only — use for official books).",
    {
      x: 0.5,
      y: 4.4,
      w: 12.3,
      h: 0.6,
      fontSize: 14,
      color: C.dark,
      fontFace: "Calibri",
    }
  );
  bullets(
    s,
    [
      "All financial writes go through SECURITY DEFINER RPCs — balanced journals only",
      "Financial shell: /financials with 28 tabs across Reporting, Ledger, Working Capital, Compliance, Planning, Platform",
    ],
    { y: 5.1, h: 1.3, fontSize: 14 }
  );
}

// ========== 6. MODULE MAP ==========
{
  const s = contentSlide(
    "Module Map — What Posts to the GL",
    "Implemented tenant apps and their accounting impact",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Module / Route", "Posts to GL?", "Mechanism"],
    [
      ["/pos + /sales", "Yes (async)", "complete_sale → queue → post_sale_to_ledger_internal"],
      ["/invoicing", "Yes on post/pay", "post_customer_invoice / pay_customer_invoice"],
      ["/receivables", "Yes", "collect_customer_receivable (POS on-account)"],
      ["/purchasing", "Yes on receive/pay", "receive_purchase_order · pay_vendor_bill · payment runs"],
      ["/expenses", "Yes", "record_expense"],
      ["/hr Payroll", "Yes on post", "post_payroll_run → Dr 6400"],
      ["/financials Banking/Treasury", "Yes", "Bank match; treasury transfers"],
      ["/inventory · /manufacturing", "No JE", "Stock movements only (except PO receive)"],
      ["/crm · /projects tasks", "No", "CRM pipeline / tasks — job cost is under Financials"],
    ],
    { colW: [3.2, 2.3, 7.0], fontSize: 11, y: 1.25 }
  );
}

sectionSlide(
  "03",
  "Business Scenario",
  "ABC Trading LLC — wholesale & retail using NexusERP as implemented",
  TOTAL
);
next();

// ========== 8. SCENARIO ==========
{
  const s = contentSlide(
    "ABC Trading LLC — Demo Company",
    "One continuous story for process validation",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Company profile",
    [
      "Industry: Wholesale & retail trading",
      "Imports finished goods; stores in warehouses",
      "Sells via POS (cash, card/mobile, on-account)",
      "Also issues formal customer invoices on credit",
      "Buys on credit from suppliers (PO → receive → bill)",
      "Pays salaries via HR payroll",
      "Records OpEx; uses bank + cash + mobile money",
      "Tracks VAT/sales tax on seeded Tax Payable (2100)",
      "Produces GL P&L, Balance Sheet, Trial Balance",
    ],
    "Workshop narrative arc",
    [
      "1. Configure org, FY, COA, tax, users",
      "2. Master data: customers, vendors, products, stores",
      "3. Opening balances (wizard)",
      "4. Buy 100 coffee bags @ $20 → receive → AP",
      "5. Sell 20 bags @ $35 via POS → COGS + revenue",
      "6. Invoice a wholesale customer; collect payment",
      "7. Record rent expense; pay vendor; reconcile bank",
      "8. Run payroll; depreciate an asset",
      "9. Period-close preflight → statements",
    ]
  );
}

sectionSlide(
  "04",
  "Company Setup & Master Data",
  "From organization creation to opening balances — what NexusERP actually configures",
  TOTAL
);
next();

// ========== SETUP ==========
{
  const s = contentSlide(
    "Company Setup Sequence",
    "Chronological configuration (implemented capabilities)",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Step", "Where", "What the system does"],
    [
      ["Organization", "Onboarding / Settings", "Creates tenant org; memberships"],
      ["Fiscal year / periods", "/financials → Periods", "ensure_fiscal_year · list_fiscal_periods"],
      ["Functional currency", "Org settings + FX tab", "Rates & FX revaluation (Wave 5)"],
      ["Tax setup", "/financials → Tax", "Tax codes; VAT liability report"],
      ["Chart of Accounts", "/financials → COA", "ensure_default_accounts + hierarchy CRUD"],
      ["Stores / registers", "/stores", "POS locations (analytic dimensions on JE)"],
      ["Warehouses", "/inventory", "Locations; stock — no JE on adjust"],
      ["Users / roles", "/team", "Base + department roles; per-app grant/deny"],
      ["Opening balances", "Manual JE wizard", "import_opening_balances → GEN JE"],
    ],
    { colW: [2.8, 3.5, 6.2], y: 1.25, fontSize: 12 }
  );
}

{
  const s = contentSlide(
    "Default Chart of Accounts (Seeded)",
    "ensure_default_accounts — codes used throughout this workshop",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Code", "Account", "Type", "Typical use"],
    [
      ["1000", "Cash on Hand", "Asset", "Cash POS / expense"],
      ["1010", "Bank", "Asset", "Bank transfer"],
      ["1020", "Mobile Money", "Asset", "M-Pesa / Telebirr etc."],
      ["1100", "Accounts Receivable", "Asset", "Invoices & on-account"],
      ["1200", "Inventory", "Asset", "Stock valuation"],
      ["1500 / 1590", "FA / Accum. Dep.", "Asset", "Fixed assets"],
      ["2000", "Accounts Payable", "Liability", "Vendor bills"],
      ["2100", "Tax Payable", "Liability", "VAT / sales tax / payroll tax bucket"],
      ["2300 / 2310", "Store Credit / Gift Cards", "Liability", "Customer liabilities"],
      ["3000 / 3900", "Equity / RE", "Equity", "Opening + close"],
      ["4000", "Sales Revenue", "Income", "POS & invoices"],
      ["5000", "COGS", "Expense", "Inventory cost of sales"],
      ["6000–6400", "OpEx / Salaries", "Expense", "Expenses & payroll"],
      ["6510", "Depreciation Exp.", "Expense", "FA depreciation"],
    ],
    { colW: [2.0, 3.5, 1.8, 5.2], y: 1.2, fontSize: 11 }
  );
}

{
  const s = contentSlide(
    "Master Data — Who / Where / Validation",
    "Customers · Vendors · Products · Inventory",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Master", "Screen", "Who", "Notes for accountants"],
    [
      ["Customers", "/customers", "Sales / AR clerk", "On-account terms; used by POS & invoicing"],
      ["Vendors", "/purchasing → Vendors", "Buyer / AP", "Required for PO & bills"],
      ["Products / variants", "/products", "Inventory", "Cost used for COGS & PO receipt valuation"],
      ["Categories", "/products", "Inventory", "Classification only"],
      ["Stores & registers", "/stores", "Ops manager", "POS login; JE store dimension"],
      ["Warehouses / stock", "/inventory", "Warehouse", "Qty movements; GL only on PO receive"],
      ["Employees", "/hr", "HR", "Payroll drivers"],
      ["Bank accounts", "/financials → Banking", "Treasury", "Statement import & match"],
    ],
    { colW: [2.4, 3.2, 2.2, 4.7], y: 1.25, fontSize: 12 }
  );
  reviewBox(s, [
    "Is the seeded COA sufficient for your entity, or do you require statutory local accounts?",
    "Should inventory adjustments (cycle count) post to GL expense/inventory — currently they do not?",
  ]);
}

sectionSlide(
  "05",
  "Purchasing & Inventory Cycle",
  "PO → Goods receipt → Inventory + AP → Vendor payment → GL",
  TOTAL
);
next();

{
  const s = contentSlide(
    "Purchase-to-Pay — Implemented Flow",
    "ABC Trading imports 100 coffee bags @ $20 = $2,000",
    TOTAL,
    next()
  );
  const steps = [
    ["1. Vendor", "Master data\n/purchasing"],
    ["2. PO", "create_purchase_order\nNo GL yet"],
    ["3. Receive", "Stock ↑ + Bill\n+ JE"],
    ["4. AP", "Vendor bill\nopen balance"],
    ["5. Pay", "pay_vendor_bill\nor payment run"],
    ["6. GL", "PUR journal\nTB / BS update"],
  ];
  steps.forEach((st, i) => {
    const x = 0.35 + i * 2.15;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.4,
      w: 2.0,
      h: 2.0,
      fill: { color: i === 2 || i === 4 ? C.softGreen : C.white },
      rectRadius: 0.06,
    });
    s.addText(st[0], {
      x: x + 0.1,
      y: 1.55,
      w: 1.8,
      h: 0.45,
      fontSize: 14,
      bold: true,
      color: C.navy,
      fontFace: "Calibri",
      align: "center",
    });
    s.addText(st[1], {
      x: x + 0.1,
      y: 2.15,
      w: 1.8,
      h: 1.0,
      fontSize: 12,
      color: C.dark,
      fontFace: "Calibri",
      align: "center",
    });
  });
  s.addText("Also implemented: MRP / purchase requisitions → convert to PO; standalone vendor bills; 3-way amount match (validate_vendor_bill_match); AP payment runs with SoD dual approval option.", {
    x: 0.5,
    y: 3.65,
    w: 12.3,
    h: 0.7,
    fontSize: 13,
    color: C.dark,
    fontFace: "Calibri",
  });
  tableSlide(
    s,
    ["Event", "Debit", "Credit", "Source"],
    [
      ["Goods receipt (PO receive)", "1200 Inventory $2,000", "2000 AP $2,000", "purchase"],
      ["Vendor payment (bank)", "2000 AP $2,000", "1010 Bank $2,000", "bill_payment"],
    ],
    { y: 4.45, colW: [3.5, 3.5, 3.5, 2.0], fontSize: 12 }
  );
}

{
  const s = contentSlide(
    "Purchase Cycle — Control Matrix",
    "Purpose · Who · Screen · Validations · Impacts",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Activity", "Who", "Screen / RPC", "Inventory", "Accounting"],
    [
      ["Create PO", "Buyer", "Purchasing · create_purchase_order", "None", "None"],
      ["Receive PO", "Warehouse / Buyer", "receive_purchase_order", "↑ qty & cost", "Dr Inv / Cr AP"],
      ["Standalone bill", "AP", "create/post_vendor_bill", "None", "Dr Exp(~6200)/Cr AP"],
      ["3-way match", "AP", "validate_vendor_bill_match", "n/a", "Amount status"],
      ["Pay bill / run", "AP / Finance", "pay_vendor_bill · payment runs", "None", "Dr AP / Cr cash|bank"],
    ],
    { colW: [2.4, 2.0, 3.4, 2.2, 2.5], y: 1.25, fontSize: 11 }
  );
  reviewBox(s, [
    "Is GR/IR clearing required for your audit model, or is direct Dr Inventory / Cr AP on receive acceptable?",
    "Should PO creation require approval workflow beyond app permissions?",
    "Is amount-only match sufficient vs quantity/price variance workflows?",
  ]);
}

{
  const s = contentSlide(
    "Inventory Reality Check",
    "What moves stock vs what moves the ledger",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Stock movements (no automatic JE)",
    [
      "Inventory adjust / cycle count",
      "Inter-warehouse transfer",
      "Fulfillment pick → pack → ship",
      "Manufacturing complete (consume + FG)",
      "Bulk product receive (products app)",
      "These update inventory_levels / movements only",
    ],
    "Stock movements with GL",
    [
      "PO receive → Dr 1200 / Cr 2000",
      "POS sale → Cr 1200 + Dr 5000 COGS (async)",
      "POS void/return → inventory restore JEs",
      "Accountant implication: cycle-count variance is operational until you post a manual JE",
      "Valuation: average/cost on variants used for COGS",
    ]
  );
}

sectionSlide(
  "06",
  "Sales, POS & Receivables",
  "Retail checkout and formal AR — both post to the same GL",
  TOTAL
);
next();

{
  const s = contentSlide(
    "Order-to-Cash — What Exists vs Classic ERP",
    "Honest scope for accountants evaluating OTC",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Implemented in NexusERP",
    [
      "POS checkout (/pos) with staff PIN",
      "Payment mix: cash, bank, mobile, on-account, store credit, gift card, loyalty",
      "Sales register analytics (/sales)",
      "Formal invoices (/invoicing) draft → post → pay",
      "Credit notes",
      "Customer statements & AR collections tools",
      "POS on-account collection (/receivables)",
      "Refunds / voids / partial returns (/refunds)",
    ],
    "Not implemented (do not demo as present)",
    [
      "Sales quotation document",
      "Sales order document",
      "Outbound delivery note as billing source",
      "Bill from delivery / SO",
      "CRM opportunity → invoice conversion",
      "Customer self-service portal",
    ]
  );
}

{
  const s = contentSlide(
    "POS Example — Sell 20 Coffee Bags @ $35",
    "Cost $20 → Revenue $700 · COGS $400 · Gross profit $300 (+ tax if configured)",
    TOTAL,
    next()
  );
  const flow = [
    "Inventory available",
    "POS sale + tender",
    "Stock ↓ 20",
    "Queue GL post",
    "Cron process-queue",
    "SAL journal",
    "P&L / TB",
  ];
  flow.forEach((t, i) => {
    const x = 0.35 + i * 1.85;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.35,
      w: 1.7,
      h: 0.85,
      fill: { color: C.white },
      rectRadius: 0.05,
    });
    s.addText(t, {
      x: x + 0.05,
      y: 1.5,
      w: 1.6,
      h: 0.55,
      fontSize: 11,
      align: "center",
      color: C.dark,
      fontFace: "Calibri",
      bold: true,
    });
  });
  tableSlide(
    s,
    ["Line", "Debit", "Credit"],
    [
      ["Cash / Bank / Mobile / AR (by tender)", "700 + tax", ""],
      ["Sales Revenue 4000", "", "700"],
      ["Tax Payable 2100 (if taxed)", "", "tax"],
      ["COGS 5000", "400", ""],
      ["Inventory 1200", "", "400"],
    ],
    { y: 2.5, colW: [5.5, 3.5, 3.5], fontSize: 13 }
  );
  s.addText("Screen: /pos · Who: Cashier · Audit: sale + journal_entry audit · Notification: configurable via Communications rules · Dashboard: sales KPIs & executive financials after post.", {
    x: 0.5,
    y: 5.5,
    w: 12.3,
    h: 0.7,
    fontSize: 13,
    color: C.dark,
    fontFace: "Calibri",
  });
  reviewBox(
    s,
    [
      "Is async posting (queue + cron) acceptable, or must sale and GL be synchronous for your controls?",
      "Confirm payment-method → account mapping matches your cash office structure.",
    ],
    6.15
  );
}

{
  const s = contentSlide(
    "Formal Invoicing Cycle",
    "/invoicing — credit sales for wholesale customers",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Step", "RPC / Screen", "GL Impact"],
    [
      ["Create draft invoice", "create_customer_invoice", "None"],
      ["Post invoice", "post_customer_invoice", "Dr 1100 AR · Cr 4000 Rev · Cr 2100 Tax"],
      ["Record payment (full/partial)", "pay_customer_invoice", "Dr cash/bank/mobile · Cr 1100"],
      ["Credit note post", "post_customer_credit_note", "Dr Rev/Tax · Cr AR / credit / cash"],
      ["Customer statement", "Statements panel", "Read — open balance"],
      ["Collections / dunning", "AR collections tools", "Policies + open invoices (Wave 2)"],
    ],
    { y: 1.3, colW: [3.5, 4.0, 5.0], fontSize: 12 }
  );
  reviewBox(s, [
    "Should invoice post require dual approval for amounts above a threshold? (JE dual approval exists under Financial Security — confirm org policy.)",
    "Is tax on invoice lines using tax codes adequate for your jurisdiction?",
  ]);
}

{
  const s = contentSlide(
    "Payment Method → GL Account Map",
    "_payment_method_account_code — hard-wired to seeded COA",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Payment method", "Account", "Balance sheet meaning"],
    [
      ["cash", "1000 Cash on Hand", "Till / petty cash"],
      ["bank_transfer", "1010 Bank", "Operating bank"],
      ["mobile_money", "1020 Mobile Money", "Wallet float"],
      ["on_account", "1100 AR", "Customer receivable"],
      ["store_credit", "2300 Store Credit", "Customer liability"],
      ["gift_card", "2310 Gift Cards", "Unredeemed liability"],
      ["loyalty", "2300 Store Credit", "Loyalty liability"],
    ],
    { y: 1.35, colW: [3.5, 3.5, 5.5], fontSize: 14 }
  );
}

sectionSlide(
  "07",
  "Expenses · Banking · Payroll · Fixed Assets",
  "Supporting cycles that also hit the general ledger",
  TOTAL
);
next();

{
  const s = contentSlide(
    "Expense Cycle",
    "/expenses — record_expense posts immediately",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Process",
    [
      "Purpose: capture OpEx (rent, utilities, misc)",
      "Who: Accountant / manager with expenses access",
      "Inputs: amount, payment method, category/account, memo, date",
      "Approval: app permission gated (no separate expense-approval workflow object beyond access)",
      "JE: Dr category or 6000 · Cr 1000/1010/1020",
      "Reports: expense register + GL P&L",
    ],
    "ABC example — Office rent $1,200 bank",
    [
      "Dr 6100 Rent (or 6000) ........ 1,200",
      "Cr 1010 Bank ................. 1,200",
      "Inventory: none",
      "Tax: none unless coded",
      "Audit: expense row + journal entry",
      "Review: do you need multi-step expense approval / employee claims?",
    ]
  );
}

{
  const s = contentSlide(
    "Banking & Treasury",
    "/financials → Banking + Treasury tabs",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Capability", "What it does", "GL impact"],
    [
      ["Bank accounts", "List / upsert bank accounts", "Master / GL link"],
      ["Statement import", "import_bank_statement", "Staging for match"],
      ["Match / auto-match", "Link statement lines to JEs", "Matching — not a new JE"],
      ["Treasury cash position", "Liquidity dashboard", "Read"],
      ["Liquidity forecast", "Weekly outlook", "Read"],
      ["Treasury transfer", "create_treasury_transfer", "Dr dest bank GL · Cr source bank GL"],
    ],
    { y: 1.3, colW: [3.2, 5.0, 4.3], fontSize: 12 }
  );
  reviewBox(s, [
    "Is bank reconciliation matching sufficient without forced period lock on unmatched items?",
    "Do treasury transfers require dual authorization in your policy? (SoD tools available under Financial Security.)",
  ]);
}

{
  const s = contentSlide(
    "Payroll Cycle (HCM)",
    "/hr → Payroll — posts on post_payroll_run",
    TOTAL,
    next()
  );
  const steps = ["Employee master", "Draft payroll", "Submit / approve", "Post run", "SALARIES JE", "Pay net (ops)"];
  steps.forEach((t, i) => {
    const x = 0.4 + i * 2.15;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y: 1.35,
      w: 2.0,
      h: 0.9,
      fill: { color: C.white },
      rectRadius: 0.05,
    });
    s.addText(`${i + 1}. ${t}`, {
      x: x + 0.08,
      y: 1.55,
      w: 1.85,
      h: 0.55,
      fontSize: 12,
      align: "center",
      color: C.dark,
      fontFace: "Calibri",
      bold: true,
    });
  });
  tableSlide(
    s,
    ["Posting (simplified)", "Debit", "Credit"],
    [
      ["Gross salaries", "6400 Salaries", ""],
      ["Tax + deductions (combined bucket)", "", "2100 Tax Payable"],
      ["Net pay", "", "Cash / Bank"],
    ],
    { y: 2.55, colW: [5.5, 3.5, 3.5], fontSize: 13 }
  );
  s.addText("Limitation to validate: payroll tax and other deductions currently credit the same 2100 Tax Payable bucket — many entities need separate payroll liability accounts.", {
    x: 0.5,
    y: 4.7,
    w: 12.3,
    h: 0.7,
    fontSize: 13,
    color: C.warn,
    fontFace: "Calibri",
  });
  reviewBox(s, [
    "Are separate employer tax / social liability accounts required for your statutory reporting?",
    "Is payroll approval chain in HCM adequate vs financial dual approval?",
  ]);
}

{
  const s = contentSlide(
    "Fixed Assets",
    "/financials → Assets — register, depreciate, dispose (+ multi-book)",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Event", "Debit", "Credit", "Notes"],
    [
      ["Register asset (buy)", "1500 Fixed Assets", "Cash / Bank", "Acquisition"],
      ["Depreciation batch (GL book)", "6510 Dep. Expense", "1590 Accum. Dep.", "Only books with posts_to_gl"],
      ["Tax book depreciation", "—", "—", "Memo book; posts_to_gl=false"],
      ["Dispose", "Proceeds + Accum.", "Asset cost ± P&L", "Gain/loss via expense netting"],
    ],
    { y: 1.3, colW: [3.5, 3.2, 3.2, 2.6], fontSize: 12 }
  );
  reviewBox(s, [
    "Confirm depreciation methods/lives match policy before first production run_depreciation_batch.",
    "Is multi-book (FIN vs TAX) sufficient for local statutory vs management books?",
  ]);
}

sectionSlide(
  "08",
  "Tax · Close · Statements · Controls",
  "Compliance, period close, financial statements, security & audit",
  TOTAL
);
next();

{
  const s = contentSlide(
    "Tax Management",
    "/financials → Tax — codes, VAT liability, returns, withholding; e-invoice stub",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Implemented",
    [
      "Tax codes (output / input / withholding)",
      "VAT liability report (output vs input)",
      "Tax return periods",
      "Withholding tax rules",
      "E-invoice documents list (internal stub auto-accept)",
      "Sales & invoice tax credited to 2100",
    ],
    "Validate with your tax lead",
    [
      "Jurisdiction-specific return forms — configure, not out-of-the-box filing",
      "Real PEPPOL / ERCA / national clearance — not live",
      "AR/AP document-currency FX on settlement — deferred",
      "Is 2100 single Tax Payable account too coarse?",
    ]
  );
}

{
  const s = contentSlide(
    "Month-End Closing — Wave 4 Orchestration",
    "/financials → Periods — checklist, preflight, lock, close",
    TOTAL,
    next()
  );
  const close = [
    ["Preflight", "run_period_close_preflight\nlists blockers"],
    ["Unposted sales", "count / post batch"],
    ["Subledger lock", "lock_period_subledgers"],
    ["Bank / AP / AR", "Operational review"],
    ["Depreciation", "run_depreciation_batch"],
    ["Close period", "P&L → 3900 RE"],
  ];
  close.forEach((c, i) => {
    const x = 0.35 + (i % 6) * 2.15;
    const y = 1.35;
    s.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 2.05,
      h: 1.5,
      fill: { color: C.white },
      rectRadius: 0.05,
    });
    s.addText(c[0], {
      x: x + 0.08,
      y: y + 0.2,
      w: 1.9,
      h: 0.4,
      fontSize: 13,
      bold: true,
      color: C.navy,
      align: "center",
      fontFace: "Calibri",
    });
    s.addText(c[1], {
      x: x + 0.08,
      y: y + 0.7,
      w: 1.9,
      h: 0.65,
      fontSize: 11,
      color: C.dark,
      align: "center",
      fontFace: "Calibri",
    });
  });
  bullets(
    s,
    [
      "Close zeros period income/expense into 3900 Retained Earnings",
      "Reopen supported (Wave 0) with cleanup of close JE when policy allows",
      "Do not close production periods during UAT unless intentionally testing",
      "Cash flow statement exists but is cash-movement oriented — not full IAS 7 O/I/F presentation",
    ],
    { y: 3.2, h: 2.2, fontSize: 14 }
  );
  reviewBox(s, [
    "Which close checklist tasks should be mandatory vs waivable in your control framework?",
    "Is retained-earnings close timing aligned with your statutory calendar?",
  ]);
}

{
  const s = contentSlide(
    "Financial Statements & Dashboards",
    "Where accountants look after posting",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Output", "Location", "Source of truth"],
    [
      ["Trial Balance", "/financials → Trial", "Posted JE lines"],
      ["Profit & Loss (GL mode)", "/financials → P&L", "Posted JE lines"],
      ["Balance Sheet", "/financials → Balance", "Posted JE lines + current earnings"],
      ["Cash Flow", "/financials → Cash flow", "Cash accounts movement (simplified)"],
      ["AR / AP Aging", "/financials → Aging", "Open invoices / bills"],
      ["Executive dashboard", "/financials → Executive", "KPI scorecard + drill-down"],
      ["Operational registers", "/reports", "Sales/expense rollups (ops mode)"],
      ["Exports", "CSV from finance tabs", "PDF statements not in accounting UI"],
    ],
    { y: 1.25, colW: [3.5, 4.0, 5.0], fontSize: 12 }
  );
}

{
  const s = contentSlide(
    "Security, Approvals & Audit Trail",
    "Access control + Financial Security (Wave 14) + audit logs",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Controls implemented",
    [
      "App-level permissions (/team) — e.g. cashier cannot open Financials",
      "JE drafts: approve / reject",
      "Optional dual approval for journals (amount threshold)",
      "SoD conflict rules + pending approval queue",
      "AP payment-run dual approval option",
      "Journal entry audit log",
      "Org audit trail on /reports",
      "Communications audit for notification events",
    ],
    "Audit questions",
    [
      "Map your SoD matrix to system SoD rules",
      "Confirm cashier vs manager matrix in UAT",
      "Decide which events must notify Finance",
      "Retain evidence: JE attachments supported on enterprise JE lifecycle",
      "External auditors: export CSV + JE audit for sample testing",
    ]
  );
}

sectionSlide(
  "09",
  "Synthesis for the Accounting Team",
  "End-to-end flow · journal catalog · strengths · gaps · questions",
  TOTAL
);
next();

{
  const s = contentSlide(
    "Complete Business Flow (ABC Trading)",
    "As implemented — retail/wholesale hybrid",
    TOTAL,
    next()
  );
  s.addText(
    "Setup → Masters → Opening Balances → PO→Receive→AP→Pay → POS Sale→COGS→Cash → Invoice→AR→Collect → Expense → Bank Rec → Payroll → FA Dep → Period Close → TB/P&L/BS",
    {
      x: 0.5,
      y: 1.35,
      w: 12.3,
      h: 0.8,
      fontSize: 15,
      color: C.dark,
      fontFace: "Calibri",
      bold: true,
    }
  );
  bullets(
    s,
    [
      "Parallel paths: retail revenue primarily via POS; wholesale via formal invoices",
      "Inventory quantity tracked broadly; inventory GL valuation driven by PO receive + COGS on sale",
      "All paths converge on journal_entry_lines → Trial Balance",
      "Process-queue cron is part of the control environment for POS posting freshness",
    ],
    { y: 2.3, h: 2.5, fontSize: 15 }
  );
  reviewBox(s, [
    "Does this retail-centric document model match how your entity actually sells?",
    "If you require classic SO/DN billing, that is a gap — not a hidden feature.",
  ]);
}

{
  const s = contentSlide(
    "Automatic Journal Catalog (Evidence)",
    "Source types accountants will see in the ledger",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Source", "Typical Dr / Cr", "Journal"],
    [
      ["sale", "Cash/AR · Rev+Tax · COGS/Inv", "SAL"],
      ["sale_void / sale_return", "Mirror / partial reverse", "SAL"],
      ["invoice / invoice_payment", "AR/Rev · Cash/AR", "INV"],
      ["credit_note", "Rev/Tax · AR/credit/cash", "INV"],
      ["purchase (PO receive)", "Inv / AP", "PUR"],
      ["vendor_bill / bill_payment", "Exp/AP · AP/Cash", "PUR"],
      ["expense", "OpEx / Cash", "GEN"],
      ["payroll", "Salaries / Tax+Cash", "GEN"],
      ["opening_balance", "Balanced import", "GEN"],
      ["period_close", "P&L wipe → RE", "GEN"],
      ["FX reval / treasury / FA / IC", "Per wave logic", "FX/BNK/DEP/IC"],
    ],
    { y: 1.2, colW: [3.5, 5.5, 3.5], fontSize: 11 }
  );
}

{
  const s = contentSlide(
    "Worked Example Pack — Coffee Bags",
    "Numbers for live walkthrough on preprod",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["#", "Business event", "Qty / Amount", "Expected GL highlight"],
    [
      ["1", "PO + receive coffee", "100 @ $20 = $2,000", "Dr 1200 / Cr 2000 $2,000"],
      ["2", "Pay supplier (bank)", "$2,000", "Dr 2000 / Cr 1010"],
      ["3", "POS sell", "20 @ $35 = $700", "Dr Cash $700 · Cr 4000 $700"],
      ["4", "COGS on sale", "20 @ $20 = $400", "Dr 5000 $400 · Cr 1200 $400"],
      ["5", "Inventory remaining", "80 bags @ $20 = $1,600", "BS Inventory"],
      ["6", "Gross profit (ex-tax)", "$300", "P&L"],
      ["7", "Wholesale invoice", "e.g. $1,000 + tax", "Dr 1100 · Cr 4000/2100"],
      ["8", "Collect invoice", "Bank", "Dr 1010 · Cr 1100"],
    ],
    { y: 1.25, colW: [0.7, 3.5, 3.5, 4.8], fontSize: 12 }
  );
}

{
  const s = contentSlide(
    "Current Strengths",
    "What professional finance teams typically value here",
    TOTAL,
    next()
  );
  bullets(
    s,
    [
      "True double-entry GL with balanced JE enforcement in SECURITY DEFINER RPCs",
      "Clear automatic posting from POS, AR, AP, expenses, payroll, FA, treasury, FX, IC",
      "Period close orchestration with preflight — reduces “close by spreadsheet” risk",
      "Subledger aging + formal invoicing + POS on-account coexist",
      "Financial shell consolidates controller workbench (28 tabs) instead of scattered menus",
      "SoD / dual approval / JE audit — control language auditors understand",
      "Async POS posting with queue depth health — operational resilience under load",
      "Evidence trail documented in ACCOUNTING_PROCESS.md + wave docs for training",
    ],
    { y: 1.35, fontSize: 15 }
  );
}

{
  const s = contentSlide(
    "Current Limitations (Do Not Over-Claim)",
    "Documented gaps vs SAP/Oracle-class OTC & statutory packaging",
    TOTAL,
    next()
  );
  tableSlide(
    s,
    ["Limitation", "Impact on validation"],
    [
      ["No quotation / sales order / DN commercial chain", "OTC demo must use POS + invoicing"],
      ["Inventory adjust / manufacturing / ship without JE", "Stock ≠ books unless manual JE or PO/sale path"],
      ["Cash flow not full IAS 7 O/I/F", "Use TB/P&L/BS for statutory narrative; CF is supportive"],
      ["E-invoicing network stub", "Cannot claim live clearance connectivity"],
      ["AR/AP multi-currency documents deferred", "FX is rates + unrealized reval + FC journals"],
      ["Payroll liabilities share 2100", "May need COA extension for statutory payroll"],
      ["PDF financial statements not in finance UI", "CSV export + external packaging"],
      ["Allocation rules RPC without dedicated UI", "Advanced allocations limited in UI"],
    ],
    { y: 1.25, colW: [5.5, 7.0], fontSize: 12 }
  );
}

{
  const s = contentSlide(
    "Questions for the Accounting Team",
    "Use this page to capture decisions during the workshop",
    TOTAL,
    next()
  );
  bullets(
    s,
    [
      "Is Dr Inventory / Cr AP on goods receipt acceptable, or do you require GR/IR clearing?",
      "Must POS post synchronously, or is queue + cron within N minutes acceptable?",
      "Which payment methods and GL accounts are mandatory for your cash office?",
      "Do we extend COA for payroll liabilities, VAT input/output split, and clearing accounts?",
      "Which SoD conflicts are blocking vs warning?",
      "What is the official reporting pack: GL P&L + BS + TB only, or also ops dashboards?",
      "Are inventory cycle counts required to post GL in phase 2?",
      "Who owns period-close checklist sign-off each month?",
      "Any local GAAP / IFRS presentation adjustments needed beyond system statements?",
    ],
    { y: 1.3, fontSize: 14 }
  );
}

{
  const s = contentSlide(
    "Suggested Improvements (Backlog Hypotheses)",
    "Prioritize only after accounting team feedback — not commitments",
    TOTAL,
    next()
  );
  bullets(
    s,
    [
      "P1 — Optional GL posting on inventory adjustment / cycle-count variance",
      "P1 — Separate payroll liability accounts (tax, pension, net pay clearing)",
      "P1 — Harden bank rec period controls (unmatched item policy)",
      "P2 — Classic OTC documents if wholesale sales-order billing is required",
      "P2 — IAS 7 cash-flow classification",
      "P2 — PDF management pack for board reporting",
      "P2 — Live e-invoicing connector per jurisdiction",
      "P3 — Allocation rules UI; dedicated payables app shell",
    ],
    { y: 1.35, fontSize: 15 }
  );
}

{
  const s = contentSlide(
    "Workshop Close",
    "How to use this deck after today",
    TOTAL,
    next()
  );
  twoCol(
    s,
    "Validation outcome",
    [
      "Accountants have seen every major posting path that exists",
      "Gaps are labeled — not hidden",
      "Worked coffee-bag example can be repeated on preprod",
      "Review questions become UAT / policy backlog",
      "Evidence sources remain in docs/ and migrations/",
    ],
    "Recommended next steps",
    [
      "Execute pilot UAT checklist (docs/ENTERPRISE-QA.md)",
      "Map COA extensions for the entity",
      "Confirm cron + unposted sales = 0 before first close",
      "Run period-close preflight on a non-prod period",
      "Schedule follow-up on P1 improvements",
    ]
  );
}

// Closing slide
{
  const s = pptx.addSlide();
  s.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: C.navy } });
  s.addText("Thank you", {
    x: 0.8,
    y: 2.4,
    w: 11.5,
    h: 0.7,
    fontSize: 44,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
  s.addText(
    "NexusERP Finance Process Validation Workshop\nEvidence-based · Double-entry · Ready for controller challenge",
    {
      x: 0.8,
      y: 3.3,
      w: 11,
      h: 1.0,
      fontSize: 18,
      color: "D4E6F1",
      fontFace: "Calibri",
    }
  );
  s.addText("Primary references: docs/ACCOUNTING_PROCESS.md · docs/EFM_ROADMAP.md · docs/ENTERPRISE-QA.md", {
    x: 0.8,
    y: 5.5,
    w: 11.5,
    h: 0.5,
    fontSize: 13,
    color: "A9CCE3",
    fontFace: "Calibri",
  });
  next();
}

await pptx.writeFile({ fileName: outFile });
console.log(`Wrote ${outFile}`);
console.log(`Slides generated: ${n} (target ~${TOTAL})`);
