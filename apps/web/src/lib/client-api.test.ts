import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/client-api";

describe("api", () => {
  afterEach(() => vi.restoreAllMocks());

  it("redirects to login when the backend proxy returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401 }));
    const redirectToLogin = vi.fn();

    await expect(api("/files", undefined, redirectToLogin)).rejects.toThrow("登录已失效");
    expect(redirectToLogin).toHaveBeenCalledOnce();
  });
});
