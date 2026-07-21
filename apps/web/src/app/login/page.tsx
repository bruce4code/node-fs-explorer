"use client";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LoginForm } from "@/components/login-form";
import { useLocale } from "@/components/locale-provider";

export default function LoginPage() {
  const { t } = useLocale();
  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-language"><LanguageSwitcher /></div>
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
        <p className="eyebrow">NODE FS EXPLORER</p>
        <h1 id="login-title">{t("loginTitle")}</h1>
        <p className="muted">{t("loginHint")}</p>
        <LoginForm />
      </section>
      <aside className="login-aside" aria-hidden="true">
        <div className="path-sample"><span>root</span><i>/</i><span>workspace</span><i>/</i><b>files</b></div>
        <div className="file-lines">
          <div><span>01</span><strong>apps</strong><small>directory</small></div>
          <div><span>02</span><strong>packages</strong><small>directory</small></div>
          <div><span>03</span><strong>README.md</strong><small>13.6 KB</small></div>
        </div>
      </aside>
    </main>
  );
}
