// src/app/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

  const inputStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    outline: "none",
    width: "100%",
    fontSize: 14,
  };

  const btnStyle: React.CSSProperties = {
    padding: 12,
    borderRadius: 12,
    border: "1px solid #111",
    background: loading ? "#e5e7eb" : "#111",
    color: loading ? "#111" : "#fff",
    cursor: loading ? "not-allowed" : "pointer",
    fontWeight: 900,
    width: "100%",
    fontSize: 15,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 16,
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(900px 500px at 20% 20%, rgba(17,17,17,0.10) 0%, rgba(255,255,255,0) 60%), linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ display: "grid", gap: 10, marginBottom: 14, textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 8,
              fontWeight: 900,
              color: "#111",
            }}
          >
            <span style={{ border: "1px solid #111", borderRadius: 999, padding: "6px 10px" }}>🔒 Acceso interno</span>
          </div>

          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 1200, letterSpacing: -0.4 }}>
            Panel de Trabajadores
          </h1>

          <p style={{ margin: 0, color: "#6b7280", fontWeight: 700 }}>
            Entra con tu email y contraseña para ver tu panel, facturas y incidencias.
          </p>
        </div>

        <div
          style={{
            border: "2px solid #111",
            borderRadius: 18,
            padding: 16,
            background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
            boxShadow: "0 14px 30px rgba(0,0,0,0.08)",
          }}
        >
          <form onSubmit={onLogin} style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900, color: "#111" }}>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="tu@email.com"
                required
                autoComplete="email"
                style={inputStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900, color: "#111" }}>Contraseña</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={inputStyle}
              />
            </label>

            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? "Entrando..." : "Entrar"}
            </button>

            {msg ? (
              <div style={{ padding: 12, borderRadius: 12, background: "#fff3f3", border: "1px solid #ffcccc", fontWeight: 800 }}>
                {msg}
              </div>
            ) : null}

            <div style={{ color: "#6b7280", fontWeight: 700, fontSize: 13, textAlign: "center", marginTop: 4 }}>
              Si no puedes entrar, avisa a administración para resetear tu acceso.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
