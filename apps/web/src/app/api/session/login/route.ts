import { NextResponse } from "next/server";
import { API_URL, SESSION_COOKIE } from "@/lib/server-api";

export async function POST(request: Request) {
  const body = await request.text();
  let upstream: Response;
  try {
    upstream = await fetch(new URL("/api/auth/login", API_URL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "无法连接文件服务，请确认后端已启动" },
      { status: 502 },
    );
  }

  const payload = await upstream.json();
  if (!upstream.ok || !payload.success) {
    return NextResponse.json(payload, { status: upstream.status });
  }

  const response = NextResponse.json({ success: true, data: { user: payload.data.user } });
  response.cookies.set(SESSION_COOKIE, payload.data.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: payload.data.expiresIn,
  });
  return response;
}
