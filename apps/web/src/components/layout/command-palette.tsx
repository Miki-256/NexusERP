"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, ArrowRight, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import { ERP_APPS, type AppDef } from "@/lib/apps-registry";

export function CommandPalette({
  accessibleAppIds,
  open,
  onOpenChange,
}: {
  accessibleAppIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const allowed = useMemo(() => new Set(accessibleAppIds), [accessibleAppIds]);

  const apps = useMemo(
    () => ERP_APPS.filter((a) => a.live && allowed.has(a.id)),
    [allowed]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps.slice(0, 12);
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.category.includes(q)
    );
  }, [apps, query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function go(app: AppDef) {
    onOpenChange(false);
    router.push(app.href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-[18%] z-50 w-full max-w-lg -translate-x-1/2",
            "rounded-xl border bg-card shadow-elevated-lg animate-scale-in",
            "focus:outline-none"
          )}
        >
          <Dialog.Title className="sr-only">Search apps and modules</Dialog.Title>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              placeholder="Search apps, modules, pages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground sm:inline">
              ESC
            </kbd>
          </div>
          <ul className="max-h-80 overflow-y-auto p-2 scrollbar-thin">
            {filtered.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">No results</li>
            ) : (
              filtered.map((app) => {
                const Icon = app.icon;
                return (
                  <li key={app.id}>
                    <button
                      type="button"
                      onClick={() => go(app)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{app.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{app.description}</p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="flex items-center gap-2 border-t px-4 py-2.5 text-2xs text-muted-foreground">
            <Command className="h-3 w-3" />
            <span>
              <kbd className="rounded border bg-muted px-1 py-0.5">⌘K</kbd> to open anywhere
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
