"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MiniCalendar } from "@/components/ui/mini-calendar";
import { formatDisplayDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

const PANEL_WIDTH = 292;
const PANEL_HEIGHT = 400;

function useCalendarPanelPosition(
  open: boolean,
  anchorRef: React.RefObject<HTMLButtonElement | null>
) {
  const [style, setStyle] = useState<React.CSSProperties>({});

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < PANEL_HEIGHT + 12 && rect.top > PANEL_HEIGHT + 12;

    let top = openAbove ? rect.top - PANEL_HEIGHT - 8 : rect.bottom + 8;
    let left = rect.left;

    left = Math.max(12, Math.min(left, window.innerWidth - PANEL_WIDTH - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - PANEL_HEIGHT - 12));

    setStyle({
      position: "fixed",
      top,
      left,
      width: PANEL_WIDTH,
      zIndex: 200,
    });
  }, [anchorRef]);

  useEffect(() => {
    if (!open) return;
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, update]);

  return style;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  disabled,
  required,
  id,
  min,
  max,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  min?: string;
  max?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const panelStyle = useCalendarPanelPosition(open, triggerRef);
  const label = value ? formatDisplayDate(value) : placeholder;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        id={id}
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        aria-required={required}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "h-10 w-full justify-start gap-2 px-3 font-normal",
          !value && "text-muted-foreground",
          open && "border-primary ring-2 ring-primary/20",
          className
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-primary/70" />
        <span className="truncate">{label}</span>
      </Button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-label="Choose date"
            className="fixed z-[200] box-border w-[292px] min-w-[292px] max-w-[292px] overflow-visible rounded-2xl border border-border bg-card text-card-foreground shadow-elevated-lg animate-scale-in"
            style={panelStyle}
          >
            <MiniCalendar
              value={value}
              min={min}
              max={max}
              onSelect={(ymd) => {
                onChange(ymd);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            />
          </div>,
          document.body
        )}
    </>
  );
}
