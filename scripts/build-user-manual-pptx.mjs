/**
 * NexusERP End-User Operations Manual — PowerPoint builder.
 * Professional department-by-department guide grounded in the live app registry
 * (apps/web/src/lib/apps-registry.ts) and shipped product surfaces.
 *
 * Regenerates: node scripts/build-user-manual-pptx.mjs
 */
import PptxGenJS from "pptxgenjs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "../docs/presentations");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "NexusERP-User-Operations-Manual.pptx");

const C = {
  navy: "0B1F33",
  blue: "1B4F72",
  teal: "0E6655",
  accent: "154360",
  light: "F4F7FA",
  white: "FFFFFF",
  dark: "1C2833",
  muted: "5D6D7E",
  line: "D5D8DC",
  soft: "EBF5FB",
  softGreen: "E8F8F5",
  softAmber: "FEF9E7",
  softRose: "FDEDEC",
  ok: "196F3D",
  warn: "9A7D0A",
};

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
pptx.layout = "WIDE";
pptx.author = "NexusERP Customer Success";
pptx.title = "NexusERP User Operations Manual";
pptx.subject = "Department-by-department guide for business users";

let slideNo = 0;
const slides = [];

function track(slide) {
  slides.push(slide);
  return slide;
}

function addFooter(slide) {
  const n = ++slideNo;
  slide.addText("NexusERP  ·  User Operations Manual  ·  Confidential", {
    x: 0.4,
    y: 7.15,
    w: 10.5,
    h: 0.25,
    fontSize: 10,
    color: C.muted,
    fontFace: "Calibri",
  });
  slide._pageNum = n;
}

function finalizePageNumbers() {
  const total = slides.length;
  for (const slide of slides) {
    const n = slide._pageNum;
    if (!n) continue;
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
    fontSize: 24,
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

function sectionDivider(label, blurb, color = C.blue) {
  const slide = track(pptx.addSlide());
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: color },
  });
  slide.addText(label, {
    x: 0.8,
    y: 2.6,
    w: 11.5,
    h: 0.7,
    fontSize: 36,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
  slide.addText(blurb, {
    x: 0.8,
    y: 3.4,
    w: 11.5,
    h: 1.2,
    fontSize: 16,
    color: "D4E6F1",
    fontFace: "Calibri",
  });
  addFooter(slide);
}

function bullets(slide, items, opts = {}) {
  const {
    x = 0.5,
    y = 1.3,
    w = 12.3,
    fontSize = 14,
    color = C.dark,
    paraSpaceAfter = 8,
  } = opts;
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
      fontSize,
      color,
      fontFace: "Calibri",
      paraSpaceAfter,
      valign: "top",
    }
  );
}

function twoCol(slide, leftTitle, leftItems, rightTitle, rightItems) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y: 1.25,
    w: 6.1,
    h: 5.5,
    fill: { color: C.soft },
    rectRadius: 0.08,
  });
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 6.8,
    y: 1.25,
    w: 6.1,
    h: 5.5,
    fill: { color: C.softGreen },
    rectRadius: 0.08,
  });
  slide.addText(leftTitle, {
    x: 0.65,
    y: 1.4,
    w: 5.6,
    h: 0.35,
    fontSize: 15,
    bold: true,
    color: C.blue,
    fontFace: "Calibri",
  });
  slide.addText(rightTitle, {
    x: 7.05,
    y: 1.4,
    w: 5.6,
    h: 0.35,
    fontSize: 15,
    bold: true,
    color: C.teal,
    fontFace: "Calibri",
  });
  bullets(slide, leftItems, { x: 0.65, y: 1.85, w: 5.6, fontSize: 13, h: 4.7, paraSpaceAfter: 6 });
  bullets(slide, rightItems, { x: 7.05, y: 1.85, w: 5.6, fontSize: 13, h: 4.7, paraSpaceAfter: 6 });
}

function numberedSteps(slide, steps, yStart = 1.3) {
  steps.forEach((step, i) => {
    const y = yStart + i * 0.85;
    slide.addShape(pptx.shapes.OVAL, {
      x: 0.5,
      y: y,
      w: 0.4,
      h: 0.4,
      fill: { color: C.blue },
    });
    slide.addText(String(i + 1), {
      x: 0.5,
      y: y + 0.05,
      w: 0.4,
      h: 0.3,
      fontSize: 14,
      bold: true,
      color: C.white,
      align: "center",
      fontFace: "Calibri",
    });
    slide.addText(step.title, {
      x: 1.1,
      y: y - 0.02,
      w: 11.5,
      h: 0.28,
      fontSize: 15,
      bold: true,
      color: C.dark,
      fontFace: "Calibri",
    });
    slide.addText(step.detail, {
      x: 1.1,
      y: y + 0.28,
      w: 11.5,
      h: 0.45,
      fontSize: 13,
      color: C.muted,
      fontFace: "Calibri",
    });
  });
}

function tipBox(slide, text, y = 6.35) {
  slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
    x: 0.4,
    y,
    w: 12.5,
    h: 0.55,
    fill: { color: C.softAmber },
    rectRadius: 0.06,
  });
  slide.addText(text, {
    x: 0.55,
    y: y + 0.1,
    w: 12.2,
    h: 0.35,
    fontSize: 12,
    color: C.dark,
    fontFace: "Calibri",
  });
}

// ---------------------------------------------------------------------------
// COVER & INTRO
// ---------------------------------------------------------------------------
{
  const slide = track(pptx.addSlide());
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: C.navy },
  });
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 5.8,
    w: 13.333,
    h: 1.7,
    fill: { color: C.accent },
  });
  slide.addText("NEXUS ERP", {
    x: 0.8,
    y: 1.8,
    w: 11.5,
    h: 0.4,
    fontSize: 16,
    color: "7FB3D5",
    fontFace: "Calibri",
    bold: true,
  });
  slide.addText("User Operations Manual", {
    x: 0.8,
    y: 2.3,
    w: 11.5,
    h: 0.8,
    fontSize: 40,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
  slide.addText(
    "A practical, department-by-department guide for cashiers, store managers,\nfinance teams, inventory staff, HR, and administrators.",
    {
      x: 0.8,
      y: 3.3,
      w: 11.5,
      h: 0.9,
      fontSize: 16,
      color: "D4E6F1",
      fontFace: "Calibri",
    }
  );
  slide.addText("Version 1.0  ·  For live production & pre-production environments", {
    x: 0.8,
    y: 6.25,
    w: 11.5,
    h: 0.35,
    fontSize: 14,
    color: C.white,
    fontFace: "Calibri",
  });
  slide.addText("Confidential — for authorized organization users", {
    x: 0.8,
    y: 6.65,
    w: 11.5,
    h: 0.3,
    fontSize: 12,
    color: "AED6F1",
    fontFace: "Calibri",
  });
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "How to use this manual", "Read your department section first, then shared workflows");
  addFooter(slide);
  bullets(slide, [
    "This is an operations manual — not a sales brochure. Steps match the screens in NexusERP today.",
    "Each department section explains: purpose, who typically uses it, step-by-step tasks, and common checks.",
    "Access depends on your role (Owner, Manager, Cashier, or custom Team permissions). If you cannot open an app, ask your administrator.",
    "Menus appear in the left sidebar and on Apps (/dashboard). Search or scroll to the module you need.",
    "When a step mentions Finance, Purchasing, or HR “manage” actions, you need manage permission for that app.",
    "Keep this deck with your SOPs. Update local procedures if your organization customizes taxes, stores, or approval rules.",
  ]);
  tipBox(slide, "Tip: Complete Settings → Organization and Stores before day-one trading so POS, inventory, and ledger share the same structure.");
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Agenda", "Manual structure");
  addFooter(slide);
  const agenda = [
    ["01", "Getting started", "Login, navigation, roles & permissions"],
    ["02", "Sales & front office", "POS, sales history, invoicing, CRM, refunds"],
    ["03", "Inventory & supply", "Products, stock, purchase, fulfillment"],
    ["04", "Finance & accounting", "Financial hub, expenses, reports"],
    ["05", "Human resources", "Employees, payroll, time off, recruitment"],
    ["06", "Services & admin", "Projects, helpdesk, stores, team, settings"],
    ["07", "End-to-end workflows", "Order-to-cash & procure-to-pay"],
  ];
  agenda.forEach((row, i) => {
    const y = 1.3 + i * 0.72;
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.5,
      y,
      w: 12.3,
      h: 0.62,
      fill: { color: i % 2 === 0 ? C.soft : C.light },
      rectRadius: 0.05,
    });
    slide.addText(row[0], {
      x: 0.7,
      y: y + 0.15,
      w: 0.8,
      h: 0.35,
      fontSize: 16,
      bold: true,
      color: C.blue,
      fontFace: "Calibri",
    });
    slide.addText(row[1], {
      x: 1.6,
      y: y + 0.08,
      w: 4,
      h: 0.45,
      fontSize: 16,
      bold: true,
      color: C.dark,
      fontFace: "Calibri",
    });
    slide.addText(row[2], {
      x: 5.8,
      y: y + 0.15,
      w: 6.7,
      h: 0.35,
      fontSize: 14,
      color: C.muted,
      fontFace: "Calibri",
    });
  });
}

// ---------------------------------------------------------------------------
// GETTING STARTED
// ---------------------------------------------------------------------------
sectionDivider(
  "1 · Getting started",
  "Sign in, find your apps, understand roles, and keep data safe.",
  C.navy
);

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Sign in & workspace", "Organization context");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Open your NexusERP URL",
      detail: "Use the link provided by your administrator (production or pre-production). Bookmark it for daily use.",
    },
    {
      title: "Sign in with your email and password",
      detail: "If you received an invite, accept it first. Use the password reset flow if you cannot sign in.",
    },
    {
      title: "Confirm the correct organization",
      detail: "If you belong to more than one organization, use the org switcher in the header before posting transactions.",
    },
    {
      title: "Open Apps or the sidebar",
      detail: "Apps (/dashboard) shows every module you can access. The sidebar groups Sales, Inventory, Finance, HR, Services, and Settings.",
    },
    {
      title: "Check notifications",
      detail: "The bell icon shows operational alerts. Open Communications for rules, queues, and delivery history if you manage messaging.",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Roles & permissions", "What you can see depends on Team access");
  addFooter(slide);
  twoCol(
    slide,
    "Typical access patterns",
    [
      "Owner / Manager — full apps, including Team, Settings, Refunds, Payroll.",
      "Cashier — POS, Sales, Products, Inventory, Customers, Time Off (defaults).",
      "Custom — administrators grant or deny each app under Team & access.",
      "Manage vs view — some actions (post ledger, create PO, run payroll) require manage rights.",
    ],
    "Good practice",
    [
      "Never share passwords or staff PINs.",
      "Cashiers should not hold Settings or Team access unless required.",
      "Review app permissions when someone changes job role.",
      "Use store-scoped work: pick the correct store/register before selling.",
      "If a button is missing, it is usually a permission — not a system error.",
    ]
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Application map by department", "Live modules in NexusERP");
  addFooter(slide);
  const rows = [
    ["Sales", "POS · Sales · Invoicing · CRM · Contacts · Refunds · Credits · Receivables"],
    ["Inventory", "Products · Inventory · Fulfillment · Purchase · Manufacturing · Promotions"],
    ["Finance", "Accounting (Financial hub) · Expenses · Reporting · Communications · Documents"],
    ["Human Resources", "Employees · Recruitment · Time Off"],
    ["Services", "Project · Helpdesk"],
    ["Settings", "Stores · Team & access · Settings (organization)"],
  ];
  slide.addTable(
    [
      [
        { text: "Department", options: { bold: true, color: C.white, fill: { color: C.navy } } },
        { text: "Applications", options: { bold: true, color: C.white, fill: { color: C.navy } } },
      ],
      ...rows.map((r, i) => [
        {
          text: r[0],
          options: { bold: true, fill: { color: i % 2 ? C.light : C.white }, color: C.dark },
        },
        { text: r[1], options: { fill: { color: i % 2 ? C.light : C.white }, color: C.dark } },
      ]),
    ],
    {
      x: 0.5,
      y: 1.35,
      w: 12.3,
      colW: [2.6, 9.7],
      border: [{ pt: 0.5, color: C.line }],
      fontFace: "Calibri",
      fontSize: 13,
      color: C.dark,
    }
  );
  tipBox(slide, "Accounting opens as “Enterprise financial hub” at /financials — the control center for GL, statements, AR/AP views, banking, and close.");
}

// ---------------------------------------------------------------------------
// SALES
// ---------------------------------------------------------------------------
sectionDivider(
  "2 · Sales & front office",
  "Serve customers, take payment, issue invoices, and manage returns with a clean audit trail.",
  C.teal
);

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Point of Sale (POS)", "Primary checkout for walk-in and counter sales");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Open Point of Sale and select store / register",
      detail: "Confirm the shift/register is open. Wrong store posts inventory and cash to the wrong location.",
    },
    {
      title: "Staff login (PIN) if required",
      detail: "Cashiers sign in with their staff PIN so receipts and discounts are attributable.",
    },
    {
      title: "Add products to the cart",
      detail: "Search by name, SKU, or barcode. Adjust quantity. Apply promotions or discounts within allowed limits.",
    },
    {
      title: "Attach customer when needed",
      detail: "Link a contact for receivables, store credit, loyalty, or invoice follow-up.",
    },
    {
      title: "Take payment and complete the sale",
      detail: "Cash, mobile money, bank transfer, on-account, or store credit. Enter tendered amount when change/tip tracking applies.",
    },
    {
      title: "Issue the receipt",
      detail: "Print or share the receipt. Sale appears under Sales history. With auto-post enabled, the ledger queue receives the sale (not pending mobile money).",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "POS — change register", "Switch Register 1 → Register 2 without leaving POS");
  addFooter(slide);
  bullets(slide, [
    "Each register is a separate URL (/pos/{register-id}), but cashiers can switch from the POS header.",
    "Use the register control (monitor icon) in the top bar — pick another register at the same store, or open All registers.",
    "Switch staff (PIN user) is a different button — that changes cashier identity, not the cash drawer register.",
    "Before switching registers mid-day, close the shift on the current register if your cash policy requires a clean Z-report.",
    "Managers can also copy register links from Stores, or open /pos to pick from the full list.",
  ], { y: 1.35 });
  tipBox(slide, "Bookmark each register on dedicated POS devices. Use Change register when one terminal covers multiple drawers.");
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "POS — payments & ledger notes", "What cashiers and managers should know");
  addFooter(slide);
  twoCol(
    slide,
    "Payment behavior",
    [
      "Cash / bank / completed mobile money — sale completes normally.",
      "Mobile money with reference may stay pending until webhook confirmation (organization setting).",
      "On-account increases customer receivables (pay-later).",
      "Store credit reduces the customer’s credit balance.",
      "Split payments are supported when enabled in the payment flow.",
    ],
    "Finance impact",
    [
      "Settings → Auto-post sales to ledger posts eligible completed sales asynchronously.",
      "Pending mobile payments are skipped until confirmed.",
      "Financials may show “completed sale not on the ledger” for older or failed queue items — use Post to ledger.",
      "Voids/returns are handled in Refunds with manager rights.",
      "Never delete a sale to “fix” a mistake — void or refund properly.",
    ]
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Sales history", "Orders & receipts (/sales)");
  addFooter(slide);
  bullets(slide, [
    "Open Sales to review completed, voided, and related receipt activity for your organization.",
    "Use filters and search to find a receipt number, customer, store, or date range.",
    "Open a sale for line detail, payments, and status — useful for customer disputes and end-of-day checks.",
    "Managers reconcile POS totals with Reporting (shifts) and Banking deposits.",
    "If a sale should be on the ledger but is not, Finance uses the Financials unposted-sales banner or batch post.",
  ], { y: 1.35 });
  tipBox(slide, "Daily close tip: Cashier totals the drawer → Manager reviews Sales + Reporting shifts → Finance confirms unposted sales = 0.");
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Invoicing", "Customer invoices (/invoicing)");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Open Invoicing",
      detail: "Create or review customer invoices for billed sales that are not pure counter cash tickets.",
    },
    {
      title: "Select customer and lines",
      detail: "Add products/services, quantities, prices, and tax as configured for your organization.",
    },
    {
      title: "Issue / post according to your process",
      detail: "Follow on-screen status (draft → issued/open). Collect payment against receivables when the customer pays later.",
    },
    {
      title: "Track settlement",
      detail: "Use Receivables and Financials aging/collections views so open balances do not age unnoticed.",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "CRM, Contacts, Credits & Receivables", "Customer relationship tools");
  addFooter(slide);
  twoCol(
    slide,
    "CRM & Contacts",
    [
      "CRM — manage pipeline opportunities and follow-ups.",
      "Contacts — customer master: names, phones, spend history.",
      "Keep phones accurate for receipts, loyalty, and collections.",
      "Avoid duplicate contacts; search before creating a new card.",
    ],
    "Credits & Receivables",
    [
      "Credits — view and manage store credit balances.",
      "Receivables — pay-later / on-account balances from POS or invoices.",
      "Collect payments against open balances; confirm the correct customer.",
      "Finance monitors aging in the Financial hub (Working Capital).",
    ]
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Refunds", "Returns & voids (/refunds) — manager-oriented");
  addFooter(slide);
  bullets(slide, [
    "Refunds require appropriate permissions (typically manager).",
    "Locate the original sale/receipt. Choose void (full cancellation when allowed) or partial return of lines.",
    "Select refund method (cash, original tender, store credit, etc.) as presented by the system.",
    "Inventory is relieved/restored according to the return path — verify stock after large returns.",
    "Ledger impact is handled through the refund/void posting path (including async queue where configured).",
    "Document the reason. Do not process personal “favors” outside the system.",
  ], { y: 1.35 });
  tipBox(slide, "Policy: Require manager approval for refunds above a cash threshold and for voiding same-day high-value tickets.");
}

// ---------------------------------------------------------------------------
// INVENTORY
// ---------------------------------------------------------------------------
sectionDivider(
  "3 · Inventory & supply chain",
  "Keep the catalog accurate, stock trustworthy, and purchasing tied to vendors and bills.",
  "1A5276"
);

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Products", "Catalog & variants (/products)");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Create or edit a product",
      detail: "Set name, category, sell price, cost, tax flags, and active status.",
    },
    {
      title: "Configure variants when needed",
      detail: "Size/color/SKU/barcode per variant. POS and Purchase search use these fields.",
    },
    {
      title: "Maintain cost and sell prices",
      detail: "Cost feeds COGS and purchase defaults. Sell price drives POS and invoices.",
    },
    {
      title: "Deactivate — do not delete casually",
      detail: "Historical sales reference products. Prefer inactive over hard delete when history exists.",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Inventory", "Stock by store (/inventory)");
  addFooter(slide);
  bullets(slide, [
    "View on-hand quantities by store and variant.",
    "Use stock movements / adjustments according to your SOP (cycle counts, damage, write-offs).",
    "Always select the correct store before adjusting.",
    "After receiving a Purchase Order, quantities increase at the receiving store.",
    "POS sales decrease stock at the selling store when items are stock-tracked.",
    "Investigate negative stock immediately — usually a receive/sale timing or wrong store issue.",
  ], { y: 1.35 });
  tipBox(slide, "Finance note: Inventory valuation uses moving-average cost on PO receipt. Keep unit costs accurate on purchase lines.");
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Purchase", "Vendors, purchase orders & vendor bills (/purchasing)");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Maintain vendors",
      detail: "On the Vendors tab, add name, phone, email. Activate/deactivate as relationships change.",
    },
    {
      title: "Create a Purchase Order",
      detail: "Orders tab → New Purchase Order. Choose vendor, receiving store, expected date. Search products on each line; enter qty and unit cost.",
    },
    {
      title: "Receive the PO",
      detail: "When goods arrive, use Receive. Stock increases and a vendor bill / AP path is created per system rules.",
    },
    {
      title: "Manage open orders",
      detail: "Cancel draft/ordered POs that will not be fulfilled. Do not cancel after full receipt.",
    },
    {
      title: "Pay vendor bills",
      detail: "Bills and Payment runs tabs: post bills if required, then pay (full or partial) with the correct method.",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Purchase — product search & hierarchy tips", "Avoid blank lines and orphan org units");
  addFooter(slide);
  twoCol(
    slide,
    "PO line product picker",
    [
      "Use Search product — type name, SKU, or barcode.",
      "Fields follow dark/light theme (visible against the page).",
      "Unit cost defaults from variant cost when available; override if the vendor quote differs.",
      "Add multiple lines before Create PO.",
      "Confirm receiving store matches the physical warehouse.",
    ],
    "Fulfillment & Manufacturing",
    [
      "Fulfillment — pick, pack, and ship operational flows.",
      "Manufacturing — BOM and production (manager-oriented).",
      "Promotions — discount codes and campaign rules for POS.",
      "Keep promotion windows and stack rules documented for cashiers.",
    ]
  );
}

// ---------------------------------------------------------------------------
// FINANCE
// ---------------------------------------------------------------------------
sectionDivider(
  "4 · Finance & accounting",
  "Post accurately, report confidently, and close the period with a balanced ledger.",
  C.blue
);

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Enterprise financial hub", "Accounting app → /financials");
  addFooter(slide);
  bullets(slide, [
    "Open Accounting from Apps or the sidebar. You land on the Enterprise financial hub.",
    "Set the date range toolbar (Today, MTD, Quarter, YTD, or custom) before reading KPIs and statements.",
    "Navigate by area: Home, Reporting, Ledger, Working Capital, Compliance, Planning, Platform.",
    "Use the unposted-sales banner when completed POS sales lack journal entries — Post to ledger, even if auto-post is on (historical/queue gaps).",
    "Export CSV where available for audit workpapers.",
  ], { y: 1.3, h: 4.5 });
  tipBox(slide, "Recommended daily finance check: Unposted sales → Trial Balance → Bank/cash positions → Open AR/AP aging.");
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Reporting area", "Statements & oversight");
  addFooter(slide);
  slide.addTable(
    [
      [
        { text: "Tab", options: { bold: true, color: C.white, fill: { color: C.navy } } },
        { text: "Use it to…", options: { bold: true, color: C.white, fill: { color: C.navy } } },
      ],
      ["Overview / Executive", "Management snapshot of performance for the selected period."],
      ["P&L", "Revenue, COGS, expenses — profitability for the date range."],
      ["Balance Sheet", "Assets, liabilities, equity position."],
      ["Cash Flow", "Cash movement view for the period (organization model)."],
      ["Trial Balance", "Account balances — must tie; investigate if out of balance."],
      ["Reports / Analytics", "Additional report packs and analytic views."],
    ].map((r, i) =>
      i === 0
        ? r
        : r.map((c, j) => ({
            text: c,
            options: {
              bold: j === 0,
              fill: { color: i % 2 ? C.light : C.white },
              color: C.dark,
            },
          }))
    ),
    {
      x: 0.5,
      y: 1.3,
      w: 12.3,
      colW: [3.2, 9.1],
      border: [{ pt: 0.5, color: C.line }],
      fontFace: "Calibri",
      fontSize: 13,
    }
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Ledger area", "COA, journals, periods");
  addFooter(slide);
  twoCol(
    slide,
    "Day-to-day ledger work",
    [
      "COA — chart of accounts; prefer seeded structure unless accounting redesigns it.",
      "Ledger — browse posted journal entries and lines.",
      "Manual JE — enter adjusting entries (balanced debits = credits).",
      "Never post one-sided entries; the system enforces balance on valid posts.",
      "Reference source documents in the description (receipt, bill, payroll run).",
    ],
    "Period close",
    [
      "Periods — manage fiscal periods / close checklist.",
      "Before close: clear unposted sales, reconcile bank, review AR/AP, post payroll.",
      "After close: restrict backdated posts per your control policy.",
      "Fixed assets, FX, tax, and consolidation tabs support advanced close packs when used.",
    ]
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Working capital & compliance", "Cash, AR/AP views, tax, controls");
  addFooter(slide);
  twoCol(
    slide,
    "Working Capital",
    [
      "Aging — receivables/payables aging for collections and vendor payment planning.",
      "Banking — accounts, reconciliations, and cash position support.",
      "Treasury — liquidity / treasury tools when enabled for your org.",
      "FX — multi-currency rates and related views when used.",
    ],
    "Compliance & Platform",
    [
      "Tax — tax configuration and liability views.",
      "Security — financial security / control surfaces.",
      "Automation — financial automation rules.",
      "Performance — operational performance of finance jobs.",
      "Assistant — AI financial assistant when licensed/configured.",
    ]
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Auto-post sales & the yellow banner", "Why Finance still sees unposted sales");
  addFooter(slide);
  bullets(slide, [
    "Settings → Auto-post sales to ledger turns on automatic enqueue for eligible completed sales.",
    "It does not rewrite history. Sales completed before the setting was enabled remain unposted until batch-posted.",
    "Mobile money pending confirmation is intentionally skipped until the payment completes.",
    "Posting is asynchronous (queue). If the worker is delayed or an item fails, the banner appears.",
    "Action: click Post N to ledger on Financials, then confirm Trial Balance and the sale’s journal entry.",
    "Operational target: start each accounting day with unposted eligible sales = 0.",
  ], { y: 1.3 });
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Expenses, Reporting, Communications, Documents", "Supporting finance apps");
  addFooter(slide);
  twoCol(
    slide,
    "Expenses & Reporting",
    [
      "Expenses — record operating costs with accounts/dates for P&L completeness.",
      "Attach references (vendor, memo) for audit.",
      "Reporting — shifts, cashier activity, and audit-oriented operational reports.",
      "Use Reporting with POS close; use Financials for GL statements.",
    ],
    "Communications & Documents",
    [
      "Communications — notification rules, schedules, queues, failed deliveries.",
      "Keep customer/employee contact data accurate so messages succeed.",
      "Documents — store files and links related to the business.",
      "Prefer Documents for policies and signed vendor contracts linked from SOPs.",
    ]
  );
}

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------
sectionDivider(
  "5 · Human resources",
  "Hire, organize, pay, and track leave with consistent employee records.",
  "6C3483"
);

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Employees app", "HR hub (/hr)");
  addFooter(slide);
  bullets(slide, [
    "Tabs typically include: Employees, Organization, Payroll (manage), Performance, Benefits, Analytics, Lifecycle, Integrations.",
    "Employees — create/edit people: name, job, store, salary, status (active/terminated).",
    "Prefer Terminate status over delete when payroll history must remain.",
    "Organization — company hierarchy (org units). Seed default structure, sync finance departments, or add units manually.",
    "If the header shows unit counts but the list looks empty, refresh after hierarchy fixes; units with missing parents still display as roots.",
    "Assign employees to org units for reporting and headcount.",
  ], { y: 1.3 });
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Payroll", "Preview, draft, approve, post");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Review pay components",
      detail: "Ensure default earnings/deductions/tax components exist (system can seed defaults on first use).",
    },
    {
      title: "Calculate preview",
      detail: "Runs org-wide preview for active employees. Fix salaries/components if amounts look wrong.",
    },
    {
      title: "Create payroll draft",
      detail: "Choose period dates and create a run. Open the run detail for workflow actions.",
    },
    {
      title: "Submit → Approve → Post",
      detail: "Follow approval steps. Posting creates the financial impact per HR GL mappings.",
    },
    {
      title: "Export bank file when paying",
      detail: "Use bank export from the run when your bank requires a payment file.",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Time Off & Recruitment", "Leave, attendance, hiring");
  addFooter(slide);
  twoCol(
    slide,
    "Time Off (/time-off)",
    [
      "Request leave according to leave types and balances.",
      "Managers approve leave in the workflow.",
      "Record attendance / shifts as your process requires.",
      "Keep holiday calendars updated so balances calculate correctly.",
      "Coordinate leave with payroll cut-off dates.",
    ],
    "Recruitment (/recruitment)",
    [
      "Create job requisitions and publish openings.",
      "Track applicants through stages.",
      "Onboard hired candidates into Employees.",
      "Use org units/managers consistently with the Employees org chart.",
    ]
  );
}

// ---------------------------------------------------------------------------
// SERVICES & ADMIN
// ---------------------------------------------------------------------------
sectionDivider(
  "6 · Services & administration",
  "Delivery projects, support tickets, stores, team access, and organization settings.",
  "1B4F72"
);

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Projects & Helpdesk", "Services apps");
  addFooter(slide);
  twoCol(
    slide,
    "Project (/projects)",
    [
      "Plan and track delivery tasks for internal or client work.",
      "Keep owners and due dates current.",
      "Link job costing in Finance when project cost tracking is used.",
      "Close completed projects so active lists stay clean.",
    ],
    "Helpdesk (/helpdesk)",
    [
      "Log support tickets from customers or internal users.",
      "Assign, prioritize, and resolve with clear notes.",
      "Use tickets instead of chat-only fixes for auditability.",
      "Escalate billing or inventory issues to the owning department.",
    ]
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Stores", "Locations & registers (/stores)");
  addFooter(slide);
  bullets(slide, [
    "Create each physical location as a store before POS go-live.",
    "Configure registers per store. Cashiers must open the correct register.",
    "Store choice drives inventory, sales analytics, and often cash accountability.",
    "Do not rename/repurpose stores casually mid-period — coordinate with Finance and Inventory.",
    "Deactivate closed locations instead of deleting when history exists.",
  ], { y: 1.35 });
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Team & access", "Roles, invites, app permissions (/team)");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Invite users",
      detail: "Send invites to work emails. Users accept and set passwords.",
    },
    {
      title: "Assign base role",
      detail: "Owner, Manager, Cashier (or equivalent) sets the default app set.",
    },
    {
      title: "Fine-tune app grants/denies",
      detail: "Grant Accounting to accountants; deny Refunds to cashiers if policy requires.",
    },
    {
      title: "Review quarterly",
      detail: "Remove leavers promptly. Reduce privilege when someone changes role.",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Settings", "Organization controls (/settings)");
  addFooter(slide);
  bullets(slide, [
    "Update legal name, address, tax ID, and currency carefully — currency changes need Finance oversight.",
    "POS max cashier discount % — limits discount abuse at checkout.",
    "Auto-post sales to ledger — recommended when you rely on Financial Statements / Trial Balance.",
    "Mobile payment pending/webhook behavior — understand before promising instant GL for mobile tenders.",
    "Billing & plan — subscription/plan management under Settings area when applicable.",
    "Only owners/managers should change Settings. Document changes in your change log.",
  ], { y: 1.3 });
}

// ---------------------------------------------------------------------------
// WORKFLOWS
// ---------------------------------------------------------------------------
sectionDivider(
  "7 · End-to-end business workflows",
  "How departments hand off work without breaking stock or the ledger.",
  C.teal
);

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Order-to-cash (retail)", "From shelf to settled cash and GL");
  addFooter(slide);
  const steps = [
    "Inventory / Products ensure item exists with price & cost",
    "Cashier sells on POS (correct store/register)",
    "Payment completes (or mobile confirms later)",
    "Sales history shows receipt; stock decreases",
    "Auto-post queue or Finance batch posts to ledger",
    "Banking/Reporting reconcile drawer & deposits",
  ];
  steps.forEach((t, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.5 + col * 4.2;
    const y = 1.4 + row * 2.4;
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 3.9,
      h: 1.9,
      fill: { color: row === 0 ? C.soft : C.softGreen },
      rectRadius: 0.08,
    });
    slide.addText(`Step ${i + 1}`, {
      x: x + 0.2,
      y: y + 0.25,
      w: 3.5,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: C.blue,
      fontFace: "Calibri",
    });
    slide.addText(t, {
      x: x + 0.2,
      y: y + 0.65,
      w: 3.5,
      h: 1.0,
      fontSize: 14,
      color: C.dark,
      fontFace: "Calibri",
    });
  });
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Procure-to-pay", "Vendor order → stock → bill → payment");
  addFooter(slide);
  numberedSteps(slide, [
    {
      title: "Buyer creates PO in Purchase",
      detail: "Vendor, receiving store, searchable product lines, agreed unit costs.",
    },
    {
      title: "Warehouse receives the PO",
      detail: "Receive action updates on-hand stock and creates/links AP bill activity.",
    },
    {
      title: "AP reviews the vendor bill",
      detail: "Match quantities/prices; post bill to ledger when required by your process.",
    },
    {
      title: "Treasury/AP pays the vendor",
      detail: "Use Bills or Payment runs; choose method; record partial payments when negotiating.",
    },
    {
      title: "Finance reconciles",
      detail: "Aging clears, bank matches the outflow, inventory and AP tie to Trial Balance.",
    },
  ]);
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Daily / weekly operating checklist", "Cross-department rhythm");
  addFooter(slide);
  slide.addTable(
    [
      [
        { text: "Cadence", options: { bold: true, color: C.white, fill: { color: C.navy } } },
        { text: "Owner", options: { bold: true, color: C.white, fill: { color: C.navy } } },
        { text: "Tasks", options: { bold: true, color: C.white, fill: { color: C.navy } } },
      ],
      ["Daily", "Cashier", "Open register · sell accurately · close drawer · hand over report"],
      ["Daily", "Store manager", "Review Sales & Refunds · spot-check stock · approve exceptions"],
      ["Daily", "Finance", "Clear unposted sales · glance TB · check cash/bank movements"],
      ["Weekly", "Purchasing", "Open POs · expedite receipts · vendor bill payments"],
      ["Weekly", "HR", "Leave approvals · attendance · payroll calendar prep"],
      ["Monthly", "Finance + Mgmt", "Statements · aging · period close · payroll post · VAT/tax review"],
    ].map((r, i) =>
      i === 0
        ? r
        : r.map((c) => ({
            text: c,
            options: { fill: { color: i % 2 ? C.light : C.white }, color: C.dark },
          }))
    ),
    {
      x: 0.4,
      y: 1.3,
      w: 12.5,
      colW: [1.6, 2.4, 8.5],
      border: [{ pt: 0.5, color: C.line }],
      fontFace: "Calibri",
      fontSize: 12,
    }
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Platform admin — Health", "Super-admin ops control plane");
  addFooter(slide);
  bullets(slide, [
    "Open Admin → Health for queue depth, cron heartbeat, dependencies (Sentry, Resend, Cron secret), and security pulse.",
    "Drain queues now runs the same worker as the 5-minute process-queue cron.",
    "Retry failed ledger rows; Post up to 100 clears historical unposted sales per tenant.",
    "GitHub Actions schedule can delay — use Drain if the heartbeat is older than 15 minutes.",
    "Security role is read-only; super_admin and support can drain and post.",
  ], { y: 1.35 });
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Troubleshooting quick reference", "What to check before escalating");
  addFooter(slide);
  slide.addTable(
    [
      [
        { text: "Symptom", options: { bold: true, color: C.white, fill: { color: C.navy } } },
        { text: "Likely cause / action", options: { bold: true, color: C.white, fill: { color: C.navy } } },
      ],
      ["Cannot open an app", "Missing Team permission — ask admin to grant the app."],
      ["POS product missing", "Inactive product/variant or wrong org — check Products."],
      ["Stock wrong after sale/PO", "Wrong store selected — verify store on sale and PO receive."],
      ["Unposted sales banner", "Historical sale or queue gap — Post to ledger on Financials."],
      ["PO product field blank", "Use searchable product picker; refresh after UI fix deploy."],
      ["Payroll preview error", "DB migration for volatile preview must be applied — contact admin."],
      ["Mobile sale not on GL", "Payment still pending confirmation — wait for webhook/confirm."],
    ].map((r, i) =>
      i === 0
        ? r
        : r.map((c, j) => ({
            text: c,
            options: {
              bold: j === 0,
              fill: { color: i % 2 ? C.light : C.white },
              color: C.dark,
            },
          }))
    ),
    {
      x: 0.4,
      y: 1.25,
      w: 12.5,
      colW: [3.5, 9.0],
      border: [{ pt: 0.5, color: C.line }],
      fontFace: "Calibri",
      fontSize: 12,
    }
  );
}

{
  const slide = track(pptx.addSlide());
  titleBar(slide, "Support & document control", "Keep the manual alive");
  addFooter(slide);
  bullets(slide, [
    "Escalate configuration issues to your NexusERP owner/administrator first.",
    "For accounting policy questions (which account, when to close), involve your controller — the system enforces structure, not local GAAP interpretation.",
    "Record local SOPs (refund thresholds, cash variance limits, PO approval) as addenda to this deck.",
    "When NexusERP adds modules, update only the affected department section.",
    "Training recommendation: role-based sessions (Cashier 60 min, Store manager 90 min, Finance half-day, HR 90 min).",
  ], { y: 1.35 });
  tipBox(slide, "Document control: Version 1.0 — regenerate from scripts/build-user-manual-pptx.mjs when product surfaces change materially.");
}

{
  const slide = track(pptx.addSlide());
  slide.addShape(pptx.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    fill: { color: C.navy },
  });
  slide.addText("Thank you", {
    x: 0.8,
    y: 2.5,
    w: 11.5,
    h: 0.7,
    fontSize: 36,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
  });
  slide.addText(
    "Use this manual by department, practice on pre-production first,\nand keep Finance, Inventory, and POS aligned every trading day.",
    {
      x: 0.8,
      y: 3.4,
      w: 11.5,
      h: 1.0,
      fontSize: 16,
      color: "D4E6F1",
      fontFace: "Calibri",
    }
  );
  slide.addText("NexusERP User Operations Manual  ·  Confidential", {
    x: 0.8,
    y: 6.4,
    w: 11.5,
    h: 0.35,
    fontSize: 13,
    color: "AED6F1",
    fontFace: "Calibri",
  });
}

finalizePageNumbers();
await pptx.writeFile({ fileName: outFile });
console.log(`Wrote ${slides.length} slides → ${outFile}`);
