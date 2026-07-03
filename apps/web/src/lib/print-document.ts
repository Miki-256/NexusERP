const RECEIPT_PRINT_STYLES = `
  @page {
    margin: 4mm;
    size: 80mm auto;
  }
  * {
    box-sizing: border-box;
  }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    color: #000;
    background: #fff;
    margin: 0;
    padding: 4mm;
    width: 80mm;
  }
  p {
    margin: 0 0 4px;
  }
  .text-center {
    text-align: center;
  }
  .font-bold {
    font-weight: 700;
  }
  .font-semibold {
    font-weight: 600;
  }
  .flex {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }
  .flex > span:first-child {
    flex: 1;
    min-width: 0;
  }
  .capitalize {
    text-transform: capitalize;
  }
  .mb-1 {
    margin-bottom: 4px;
  }
  .mt-1 {
    margin-top: 4px;
  }
  .mt-2 {
    margin-top: 8px;
  }
  .mt-4 {
    margin-top: 16px;
  }
  .my-2 {
    margin-top: 8px;
    margin-bottom: 8px;
  }
  .text-xs,
  [class*="text-[10px]"] {
    font-size: 10px;
  }
  .text-gray-600,
  [class*="text-gray"] {
    color: #555;
  }
  [class*="text-amber"] {
    color: #b45309;
  }
  hr {
    border: 0;
    border-top: 1px dashed #000;
    margin: 8px 0;
  }
`;

/** Print HTML in an isolated iframe so fixed POS/modal layout does not affect output. */
export function printHtmlDocument(title: string, bodyHtml: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    width: "0",
    height: "0",
    border: "none",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc || !win) {
    iframe.remove();
    window.print();
    return;
  }

  doc.open();
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${RECEIPT_PRINT_STYLES}</style></head><body>${bodyHtml}</body></html>`
  );
  doc.close();

  const cleanup = () => {
    win.removeEventListener("afterprint", cleanup);
    setTimeout(() => iframe.remove(), 300);
  };

  win.addEventListener("afterprint", cleanup);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      win.focus();
      win.print();
    });
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
