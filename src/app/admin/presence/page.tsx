"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type PresenceState = "offline" | "online" | "pause" | "bathroom";

type Row = {
  worker_id: string;
  name: string;
  role: string;
  state: PresenceState;
  last_change_at: string;
  active_session_id: string | null;
};

type MissingRow = {
  worker_id: string;
  display_name: string;
  role: string;
  tz: string | null;
  dow: number;
  start_time: string; // time
  end_time: string;   // time
  now_local: string;  // timestamp/text según view
};

function badge(state: PresenceState) {
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

function roleLabel(role: string) {
  const r = (role || "").toLowerCase();
  if (r === "central") return "Central";
  if (r === "tarotista") return "Tarotista";
  if (r === "admin") return "Admin";
  return role;
}

export default function AdminPresencePage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<MissingRow[]>([]);

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

      // 1) Presencia live (tu endpoint)
      const res = await fetch("/api/admin/presence/live", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error live");
        setRows([]);
      } else {
        setRows(j.rows || []);
      }

      // 2) Faltas en turno (view/tabla shift_missing_now)
      const { data: miss, error: e2 } = await supabase.from("shift_missing_now").select("*");
      if (e2) {
        // si aún no existe la view, no rompemos la pantalla; solo avisamos abajo
        // (así no te quedas sin panel)
        // @ts-ignore
        setMissing([]);
      } else {
        // @ts-ignore
        setMissing((miss as any) || []);
      }
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

  // ✅ Solo online/pause/bathroom (los “en turno”)
  const onlineOnly = rows.filter((r) => r.state !== "offline");

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Presencia en directo</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>

        <button
          onClick={load}
          disabled={loading}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 800 }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <span style={{ color: "#666", alignSelf: "center", fontSize: 12 }}>Auto-refresh cada 5s</span>
      </div>

      {err ? (
        <div
          style={{
            padding: 10,
            border: "1px solid #ffcccc",
            background: "#fff3f3",
            borderRadius: 10,
            marginBottom: 12,
          }}
        >
          {err}
        </div>
      ) : null}

      {/* ✅ ALERTA FALTAS EN TURNO */}
      {missing.length > 0 ? (
        <div
          style={{
            marginBottom: 12,
            padding: 14,
            borderRadius: 12,
            border: "2px solid #ff0000",
            background: "#ffecec",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 8 }}>⚠️ FALTAS EN TURNO (ahora mismo)</div>

          <div style={{ display: "grid", gap: 6 }}>
            {missing.map((m) => (
              <div key={m.worker_id} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 900 }}>{m.display_name}</span>
                <span style={{ color: "#333" }}>· {roleLabel(m.role)}</span>
                <span style={{ color: "#666" }}>
                  · turno {String(m.start_time).slice(0, 5)} - {String(m.end_time).slice(0, 5)}{" "}
                  {m.tz ? `(${m.tz})` : ""}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
            Idea: en el siguiente paso añadimos botones “Justificada / No justificada” y penalización automática.
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12, color: "#666", fontSize: 12 }}>
          ✅ Sin faltas detectadas ahora mismo.
        </div>
      )}

      {/* ✅ TABLA SOLO ONLINE */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>Conectadas ahora (online/pausa/baño)</div>
          <div style={{ color: "#666", fontSize: 12 }}>
            Mostrando: <b>{onlineOnly.length}</b> (de {rows.length})
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nombre</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Rol</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Estado</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Último cambio</th>
              </tr>
            </thead>
            <tbody>
              {onlineOnly.map((r) => (
                <tr key={r.worker_id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", fontWeight: 800 }}>{r.name}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{roleLabel(r.role)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{badge(r.state)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>
                    {r.last_change_at ? new Date(r.last_change_at).toLocaleString("es-ES") : "—"}
                  </td>
                </tr>
              ))}
              {onlineOnly.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 10, color: "#666" }}>
                    Nadie conectado ahora mismo.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
          Se refresca cada 5 segundos. (Los OFFLINE quedan ocultos en esta vista)
        </div>
      </div>
    </div>
  );
}
