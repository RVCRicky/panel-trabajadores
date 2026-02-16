"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/panel");
    });
  }, [router]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setMsg(error.message);
        return;
      }

      router.replace("/panel");
    } catch (err: any) {
      setMsg(err?.message || "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420, border: "1px solid #ddd", borderRadius: 12, padding: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Panel de Trabajadores</h1>
        <p style={{ marginTop: 6, color: "#666" }}>Inicia sesión con email y contraseña</p>

        <form onSubmit={onLogin} style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="tu@email.com"
              required
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Contraseña</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              required
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #111",
              background: loading ? "#eee" : "#111",
              color: loading ? "#111" : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          {msg ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
              {msg}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
