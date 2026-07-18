"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
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
      <label><span>用户名</span><div className="input-shell"><UserRound size={16} /><input name="username" autoComplete="username" required autoFocus /></div></label>
      <label><span>密码</span><div className="input-shell"><LockKeyhole size={16} /><input name="password" type="password" autoComplete="current-password" required /></div></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button" disabled={loading}>{loading ? "正在验证..." : "进入工作台"}<ArrowRight size={16} /></button>
    </form>
  );
}
