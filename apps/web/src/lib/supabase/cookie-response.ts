import { NextResponse } from "next/server";

type CookieLike = {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: true | false | "lax" | "strict" | "none" | undefined;
};

/** Copy Set-Cookie headers onto a new response (middleware redirects must not drop auth cookies). */
export function copyCookiesOnto(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    const { name, value, ...options } = cookie as CookieLike;
    to.cookies.set(name, value, options);
  });
  return to;
}

export function redirectWithCookies(
  url: URL,
  cookieSource: NextResponse,
  status = 307
): NextResponse {
  return copyCookiesOnto(cookieSource, NextResponse.redirect(url, status));
}
