/** App origin for auth redirects (client uses window; server uses env). */
export function getAppOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3003";
}

/** Build Supabase auth redirect URL with a post-auth in-app path. */
export function authCallbackUrl(nextPath: string) {
  return `${getAppOrigin()}/auth/callback?next=${encodeURIComponent(nextPath)}`;
}

export function authLinkErrorMessage(code: string | null, fallback?: string | null) {
  switch (code) {
    case "otp_expired":
      return "That email link has expired. Request a new password reset or sign up again.";
    case "access_denied":
      return fallback ?? "Email link is invalid or has expired. Request a new link.";
    default:
      return fallback ?? "Could not complete email verification. Try again or contact support.";
  }
}
