import { NextRequest, NextResponse } from "next/server";
import { POST_AUTH_BOOTSTRAP_PATH } from "@/lib/post-auth-path";

/** Legacy alias — 303 to page route so POST (from Next.js redirects) never 405s. */
function redirectToBootstrapPage(request: NextRequest) {
  return NextResponse.redirect(new URL(POST_AUTH_BOOTSTRAP_PATH, request.url), 303);
}

export async function GET(request: NextRequest) {
  return redirectToBootstrapPage(request);
}

export async function POST(request: NextRequest) {
  return redirectToBootstrapPage(request);
}

export async function HEAD(request: NextRequest) {
  return redirectToBootstrapPage(request);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, HEAD, OPTIONS",
    },
  });
}
