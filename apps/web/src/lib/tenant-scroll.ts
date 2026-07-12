import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

/** The tenant app scrolls inside `<main>`, not `window`. */
export function getTenantMainElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector("main");
}

/** Replace URL search params without triggering a Next.js RSC refetch (tab/area only). */
export function replaceTenantUrlQuery(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  const url = query ? `${pathname}?${query}` : pathname;
  window.history.replaceState(window.history.state, "", url);
}

/** Re-apply main scroll after client navigation / RSC updates. */
export function restoreTenantMainScroll(main: HTMLElement | null, scrollTop: number) {
  if (!main || scrollTop <= 0) return;

  const apply = () => {
    if (main.isConnected) main.scrollTop = scrollTop;
  };

  apply();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  });
  for (const delay of [50, 150, 400]) {
    window.setTimeout(apply, delay);
  }
}

/** Soft navigation that keeps the tenant main scroll position. */
export function replaceTenantUrl(
  router: AppRouterInstance,
  pathname: string,
  params: URLSearchParams
) {
  const main = getTenantMainElement();
  const scrollTop = main?.scrollTop ?? 0;
  const query = params.toString();
  const url = query ? `${pathname}?${query}` : pathname;

  router.replace(url, { scroll: false });
  restoreTenantMainScroll(main, scrollTop);
}

/** Refresh server data without jumping the tenant main scroll position. */
export function refreshPreservingTenantScroll(
  router: AppRouterInstance,
  preservedScrollTop?: number
) {
  const main = getTenantMainElement();
  const scrollTop = preservedScrollTop ?? main?.scrollTop ?? 0;
  router.refresh();
  restoreTenantMainScroll(main, scrollTop);
}
