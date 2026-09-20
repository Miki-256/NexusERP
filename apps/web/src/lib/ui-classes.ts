/** Shared Tailwind classes for native form controls and dense ERP chrome. */

export const SELECT_CLS =
  "flex h-control w-full rounded-md border border-input bg-background px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

export const TEXTAREA_CLS =
  "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

/** Default dense page vertical rhythm. */
export const PAGE_SHELL = "space-y-3 sm:space-y-4";

/** Roomier rhythm for auth / marketing surfaces. */
export const PAGE_SHELL_COMFORT = "space-y-4 sm:space-y-6";

export const SECTION_TITLE = "text-sm font-semibold text-foreground";

export const MUTED_TEXT = "text-sm text-muted-foreground";

/** Dense panel surface (aliases of .enterprise-panel*). */
export const PANEL = "enterprise-panel";
export const PANEL_HEADER = "enterprise-panel-header";
export const PANEL_BODY = "enterprise-panel-body";

/** Shell content padding (pair with pb-mobile-nav on main). */
export const CONTENT_PAD = "px-3 pt-2 sm:px-5 sm:pt-4 lg:px-7 lg:pt-6";
