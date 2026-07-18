import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
        <p className="eyebrow">NODE FS EXPLORER</p>
        <h1 id="login-title">登录文件工作台</h1>
        <p className="muted">使用文件服务中配置的账户继续。</p>
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
