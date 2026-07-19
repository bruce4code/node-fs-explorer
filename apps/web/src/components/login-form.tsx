"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";

const DEMO_ACCOUNT = { username: "admin", password: "pass123" };

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "登录失败");
      window.location.href = "/";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
      setLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label><span>用户名</span><div className="input-shell"><UserRound size={16} /><input name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required autoFocus /></div></label>
      <label><span>密码</span><div className="input-shell"><LockKeyhole size={16} /><input name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></div></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="secondary-button demo-account-button" disabled={loading} onClick={() => { setUsername(DEMO_ACCOUNT.username); setPassword(DEMO_ACCOUNT.password); setError(""); }}>使用演示账号</button>
      <button className="primary-button" disabled={loading}>{loading ? "正在验证..." : "进入工作台"}<ArrowRight size={16} /></button>
    </form>
  );
}
