import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/login-form";
import { LocaleProvider } from "@/components/locale-provider";

describe("LoginForm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fills the demo credentials and sends them to the session endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Invalid credentials" }) });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.clear();
    render(<LocaleProvider><LoginForm /></LocaleProvider>);

    await user.click(screen.getByRole("button", { name: "Use demo account" }));
    expect(screen.getByRole("textbox", { name: "Username" })).toHaveValue("admin");
    expect(screen.getByLabelText("Password")).toHaveValue("pass123");

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/session/login", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "pass123" }),
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });
});
