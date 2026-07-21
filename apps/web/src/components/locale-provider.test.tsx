import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LocaleProvider, useLocale } from "@/components/locale-provider";

function LocaleHarness() {
  const { locale, setLocale, t } = useLocale();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>{t("fileSpace")}</button>;
}

describe("LocaleProvider", () => {
  it("defaults to English and switches to Chinese", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    render(<LocaleProvider><LocaleHarness /></LocaleProvider>);

    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Files" }));
    expect(await screen.findByRole("button", { name: "文件空间" })).toBeInTheDocument();
    expect(window.localStorage.getItem("node-fs-locale")).toBe("zh-CN");
  });
});
