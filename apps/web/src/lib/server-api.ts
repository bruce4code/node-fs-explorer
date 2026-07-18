import { cookies } from "next/headers";

export const SESSION_COOKIE = "fms_session";
export const API_URL = process.env.FILE_API_URL || "http://127.0.0.1:3300";

export async function getToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export function apiUrl(path: string) {
  return new URL(path, API_URL).toString();
}
