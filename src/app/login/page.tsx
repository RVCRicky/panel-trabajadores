// src/app/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

async function readJsonSafe(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    return { json: text ? JSON.parse(text) : null, text };
  } catch {
    return { json: null, text };
  }
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ✅ Si ya hay sesión, validamos /api/me antes de redirigir
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const { json, text } = await readJsonSafe(res);

        if (!alive) return;

        if (!res.ok || !json?.ok || !json?.worker || !json.worker?.is_active) {
          await supabase.auth.signOut();
          setMsg(
            `Sesión detectada pero inválida para panel.\n` +
              `GET /api/me -> ${res.status}\n` +
              `${json?.error ? `Error: ${json.error}\n` : ""}` +
              `${!json ? `Respuesta: ${text.slice(0, 200)}\n` : ""}` +
              `Inicia sesión de nuevo.`
          );
          return;
        }

        // ✅ Punto único de entrada: /panel (ahí se decide el rol y se redirige)
        router.replace("/panel");
      } catch {
        // si falla algo, nos quedamos en login
      }
    })();

    return () => {
      alive = false;
    };
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
        setMsg(`Login error: ${error.message}`);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        setMsg("No se pudo crear sesión (sin token). Intenta de nuevo.");
        await supabase.auth.signOut();
        return;
      }

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const { json, text } = await readJsonSafe(res);

      if (!res.ok) {
        await supabase.auth.signOut();
        setMsg(
          `No puedo validar tu acceso al panel.\n` +
            `GET /api/me -> ${res.status}\n` +
            `${json?.error ? `Error: ${json.error}\n` : ""}` +
            `${!json ? `Respuesta: ${text.slice(0, 200)}\n` : ""}`
        );
        return;
      }

      if (!json?.ok || !json?.worker) {
        await supabase.auth.signOut();
        setMsg(
          `No puedo validar tu worker.\n` +
            `GET /api/me -> ${res.status}\n` +
            `${json?.error ? `Error: ${json.error}\n` : ""}` +
            `${!json ? `Respuesta: ${text.slice(0, 200)}\n` : ""}`
        );
        return;
      }

      if (!json.worker.is_active) {
        await supabase.auth.signOut();
        setMsg("Tu usuario está inactivo. Contacta con administración.");
        return;
      }

      // ✅ Punto único de entrada: /panel (ahí se decide el rol y se redirige)
      router.replace("/panel");
    } catch (err: any) {
      setMsg(err?.message || "Error inesperado");
      try {
        await supabase.auth.signOut();
      } catch {}
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
          <div style={{ display: "inline-flex", justifyContent: "center", alignItems: "center", gap: 8, fontWeight: 900, color: "#111" }}>
            <span style={{ border: "1px solid #111", borderRadius: 999, padding: "6px 10px" }}>🔒 Acceso interno</span>
          </div>

          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 1200, letterSpacing: -0.4 }}>Panel de Trabajadores</h1>
          <p style={{ margin: 0, color: "#6b7280", fontWeight: 700 }}>
            Entra con tu email y contraseña para ver tu panel, facturas e incidencias.
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
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: "#fff3f3",
                  border: "1px solid #ffcccc",
                  fontWeight: 800,
                  whiteSpace: "pre-wrap",
                }}
              >
                {msg}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}
