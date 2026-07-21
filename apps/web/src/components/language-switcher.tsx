"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Languages } from "lucide-react";
import { useLocale } from "@/components/locale-provider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button language-switcher" aria-label={t("language")}><Languages size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown" align="end"><DropdownMenu.Item onSelect={() => setLocale("en")}>{t("english")}{locale === "en" ? " ✓" : ""}</DropdownMenu.Item><DropdownMenu.Item onSelect={() => setLocale("zh-CN")}>{t("chinese")}{locale === "zh-CN" ? " ✓" : ""}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}
