import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server-api";

export function proxy(request: NextRequest) {
  const authenticated = request.cookies.has(SESSION_COOKIE);
  if (!authenticated && request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (authenticated && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/", "/login"] };
