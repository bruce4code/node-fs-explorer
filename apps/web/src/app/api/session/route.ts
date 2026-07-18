import { NextResponse } from "next/server";
import { API_URL, getToken, SESSION_COOKIE } from "@/lib/server-api";

export async function GET() {
  const token = await getToken();
  if (!token) return NextResponse.json({ authenticated: false }, { status: 401 });
  try {
    const upstream = await fetch(new URL("/api/auth/verify", API_URL), {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const payload = await upstream.json();
    if (!upstream.ok || !payload.success) {
      const response = NextResponse.json({ authenticated: false }, { status: 401 });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    return NextResponse.json({ authenticated: true, user: payload.data.user });
  } catch {
    return NextResponse.json({ authenticated: false, error: "文件服务不可用" }, { status: 502 });
  }
}
