"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Row = {
  worker_id: string;
  name: string;
  role: string;
  state: "offline" | "online" | "pause" | "bathroom";
  last_change_at: string;
  active_session_id: string | null;
};

function badge(state: Row["state"]) {
  const base: any = {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 900,
    border: "1px solid #ddd",
    fontSize: 12,
  };
  if (state === "online") return <span style={{ ...base, background: "#eaffea" }}>ONLINE</span>;
  if (state === "pause") return <span style={{ ...base, background: "#fff6dd" }}>PAUSA</span>;
  if (state === "bathroom") return <span style={{ ...base, background: "#e8f4ff" }}>BAÑO</span>;
  return <span style={{ ...base, background: "#f4f4f4" }}>OFFLINE</span>;
}

export default function AdminPresencePage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/admin/presence/live", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "Error live");
      setRows(j.rows || []);
    } catch (e: any) {
      setErr(e?.message || "Error live");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // refresco cada 5s
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Presencia en directo</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>

        <button onClick={load} disabled={loading} style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 800 }}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>{err}</div>
      ) : null}

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nombre</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Rol</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Estado</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Último cambio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.worker_id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", fontWeight: 800 }}>{r.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.role}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{badge(r.state)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>
                  {new Date(r.last_change_at).toLocaleString("es-ES")}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, color: "#666" }}>
                  No hay datos todavía (nadie ha logueado o falta crear presence_current para workers).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
          Se refresca cada 5 segundos.
        </div>
      </div>
    </div>
  );
}
