"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useNavigation } from "@/components/layout/navigation-context";

export function NavigationProgress() {
  const pathname = usePathname();
  const { isNavigating } = useNavigation();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (!isNavigating) return;

    setVisible(true);
    setWidth(12);

    const t1 = setTimeout(() => setWidth(38), 40);
    const t2 = setTimeout(() => setWidth(62), 120);

    timerRef.current = setInterval(() => {
      setWidth((w) => (w >= 90 ? w : w + 1.5));
    }, 80);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isNavigating]);

  useEffect(() => {
    if (pathname === prevPath.current) return;
    prevPath.current = pathname;

    if (timerRef.current) clearInterval(timerRef.current);
    setWidth(100);
    const hide = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 280);
    return () => clearTimeout(hide);
  }, [pathname]);

  if (!visible && width === 0) return null;

  return (
    <div
      className="nexus-progress-track pointer-events-none fixed inset-x-0 top-0 z-[100]"
      aria-hidden
      role="progressbar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="nexus-progress-bar transition-[width] duration-200 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
