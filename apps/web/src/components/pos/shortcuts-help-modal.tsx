"use client";

import { X } from "lucide-react";

const SHORTCUTS = [
  { key: "F2", label: "Focus search / barcode" },
  { key: "F3", label: "Hold current sale" },
  { key: "F4", label: "Recall held sale" },
  { key: "F5", label: "Find customer" },
  { key: "F6", label: "Close shift" },
  { key: "F7", label: "Void / refunds" },
  { key: "F8", label: "Checkout" },
  { key: "F9", label: "Camera barcode scan" },
  { key: "Esc", label: "Close modal" },
];

export function ShortcutsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="pos-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="pos-heading text-lg font-bold text-slate-900">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li
              key={s.key}
              className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
            >
              <span className="text-slate-700">{s.label}</span>
              <kbd className="rounded-md bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                {s.key}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
