"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent,
} from "react";

export type HorizontalScrollState = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

function readScrollState(el: HTMLElement): HorizontalScrollState {
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 2) {
    return { canScrollLeft: false, canScrollRight: false };
  }
  return {
    canScrollLeft: el.scrollLeft > 4,
    canScrollRight: el.scrollLeft < max - 4,
  };
}

/**
 * Enterprise horizontal scroll: touch momentum, drag-to-scroll, wheel support,
 * active-item scroll-into-view, and overflow edge detection.
 */
export function useHorizontalScroll(activeItemSelector?: string) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const [edges, setEdges] = useState<HorizontalScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const refreshEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges(readScrollState(el));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(refreshEdges);
    ro.observe(el);
    el.addEventListener("scroll", refreshEdges, { passive: true });
    refreshEdges();

    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", refreshEdges);
    };
  }, [refreshEdges]);

  useEffect(() => {
    if (!activeItemSelector || !ref.current) return;
    const active = ref.current.querySelector<HTMLElement>(activeItemSelector);
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    const t = window.setTimeout(refreshEdges, 280);
    return () => window.clearTimeout(t);
  }, [activeItemSelector, refreshEdges]);

  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const dominantHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = dominantHorizontal ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (delta === 0) return;
    el.scrollLeft += delta;
    e.preventDefault();
  }, []);

  const onPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;

    dragRef.current = { active: true, startX: e.clientX, scrollLeft: el.scrollLeft };
    el.setPointerCapture(e.pointerId);
    el.classList.add("pos-horizontal-scroll--dragging");
  }, []);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !ref.current) return;
    const dx = e.clientX - dragRef.current.startX;
    ref.current.scrollLeft = dragRef.current.scrollLeft - dx;
  }, []);

  const endDrag = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !ref.current) return;
    dragRef.current.active = false;
    ref.current.classList.remove("pos-horizontal-scroll--dragging");
    try {
      ref.current.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    refreshEdges();
  }, [refreshEdges]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const step = Math.max(120, el.clientWidth * 0.35);
      if (e.key === "ArrowRight") {
        el.scrollBy({ left: step, behavior: "smooth" });
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        el.scrollBy({ left: -step, behavior: "smooth" });
        e.preventDefault();
      } else if (e.key === "Home") {
        el.scrollTo({ left: 0, behavior: "smooth" });
        e.preventDefault();
      } else if (e.key === "End") {
        el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
        e.preventDefault();
      }
    },
    []
  );

  return {
    ref,
    edges,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown,
    refreshEdges,
  };
}

export function HorizontalScrollStrip({
  children,
  className,
  ariaLabel,
  activeItemSelector,
  scrollRef,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel: string;
  activeItemSelector?: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const {
    ref: internalRef,
    edges,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onKeyDown,
  } = useHorizontalScroll(activeItemSelector);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalRef.current = node;
      if (scrollRef) scrollRef.current = node;
    },
    [internalRef, scrollRef]
  );

  return (
    <div className="pos-horizontal-scroll-wrap">
      <div
        className={cnFade("pos-horizontal-scroll-fade-left", edges.canScrollLeft)}
        aria-hidden
      />
      <div
        ref={setRef}
        className={cnMerge("pos-horizontal-scroll", className)}
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
      <div
        className={cnFade("pos-horizontal-scroll-fade-right", edges.canScrollRight)}
        aria-hidden
      />
    </div>
  );
}

function cnFade(base: string, visible: boolean) {
  return `${base}${visible ? " is-visible" : ""}`;
}

function cnMerge(...parts: (string | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
