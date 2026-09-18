export const locales = ["en", "am"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "en" || value === "am";
}

export function localeToBcp47(locale: AppLocale): string {
  return locale === "am" ? "am-ET" : "en-ET";
}
