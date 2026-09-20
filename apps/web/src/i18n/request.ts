import { cookies } from "next/headers";
import { defaultLocale, isAppLocale, LOCALE_COOKIE, type AppLocale } from "./config";

export async function getRequestLocale(): Promise<AppLocale> {
  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (isAppLocale(fromCookie)) return fromCookie;
  return defaultLocale;
}

export async function getMessages(locale: AppLocale) {
  switch (locale) {
    case "am":
      return (await import("../../messages/am.json")).default;
    default:
      return (await import("../../messages/en.json")).default;
  }
}
