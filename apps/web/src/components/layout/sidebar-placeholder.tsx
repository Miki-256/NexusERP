/** Placeholder while client sidebar loads (avoids SSR hydration drift in dev). */
export function SidebarPlaceholder() {
  return (
    <aside
      className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:flex"
      aria-hidden
    />
  );
}
