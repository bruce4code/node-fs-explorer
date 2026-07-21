import type { ApiResponse } from "@file-manager/contracts";

export async function api<T>(path: string, init?: RequestInit, onUnauthorized = () => window.location.assign("/login")): Promise<T> {
  const response = await fetch(`/api/backend${path}`, init);
  if (response.status === 401) {
    onUnauthorized();
    throw new Error("登录已失效");
  }
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.success) {
    throw new Error("error" in payload ? payload.error : `请求失败 (${response.status})`);
  }
  return payload.data;
}

export function joinPath(base: string, name: string) {
  return base === "." ? name : `${base.replace(/\/$/, "")}/${name}`;
}

export function formatBytes(value = 0) {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function displayDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
