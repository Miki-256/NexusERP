"use client";

import { useEffect, useState } from "react";

/** Matches Tailwind `lg` — tenant shell uses bottom nav below this width. */
export function useIsMobileNav() {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return mobile;
}

/** Phone-sized viewports — POS product grid uses roomier cards. */
export function useIsPhone() {
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return phone;
}
