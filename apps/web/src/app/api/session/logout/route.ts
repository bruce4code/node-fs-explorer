import { NextResponse } from "next/server";
import { API_URL, getToken, SESSION_COOKIE } from "@/lib/server-api";

export async function POST() {
  const token = await getToken();
  if (token) {
    try {
      await fetch(new URL("/api/auth/logout", API_URL), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
    } catch {
      // The local session still needs to end if the API is unavailable.
    }
  }
  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
