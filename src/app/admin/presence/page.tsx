"use client";

import { useEffect, useMemo, useState } from "react";
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
  name: string;
  role: string;
  expected_state: "should_be_online";
  reason: string; // ej: "shift_now"
};

type ApiResp =
  | {
      ok: true;
      rows: Row[];
      missingCount?: number;
      missing?: MissingRow[];
      now?: string;
    }
  | { ok: false; error: string };

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

function fmtDateTime(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-ES");
  } catch {
    return iso;
  }
}

export default function AdminPresencePage() {
  const router = useRouter();

  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<MissingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState<string>("");

  // ✅ filtro: por defecto SOLO online/pause/bathroom (es decir, “conectados”)
  const [onlyOnline, setOnlyOnline] = useState(true);

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

      const j = (await res.json().catch(() => null)) as ApiResp | null;
      if (!j || !j.ok) {
        setErr((j as any)?.error || "Error live");
        return;
      }

      setRows(j.rows || []);
      setMissing(j.missing || []);
      setNow(j.now || "");
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

  const shownRows = useMemo(() => {
    if (!onlyOnline) return rows;
    return rows.filter((r) => r.state !== "offline");
  }, [rows, onlyOnline]);

  const counts = useMemo(() => {
    let online = 0,
      pause = 0,
      bathroom = 0,
      offline = 0;
    for (const r of rows) {
      if (r.state === "online") online++;
      else if (r.state === "pause") pause++;
      else if (r.state === "bathroom") bathroom++;
      else offline++;
    }
    return { online, pause, bathroom, offline };
  }, [rows]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Presencia en directo</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
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

        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          <input type="checkbox" checked={onlyOnline} onChange={(e) => setOnlyOnline(e.target.checked)} />
          Mostrar solo conectados (online/pausa/baño)
        </label>

        <div style={{ color: "#666" }}>
          Ahora: <b>{now ? fmtDateTime(now) : "—"}</b>
        </div>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

      {/* ✅ ALERTA: los que deberían estar y no están */}
      <div style={{ border: "1px solid #111", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 900 }}>Faltas / No logueados en turno</div>
          <div style={{ fontWeight: 900 }}>
            Pendientes:{" "}
            <span style={{ padding: "4px 10px", borderRadius: 999, background: missing.length ? "#fff3f3" : "#f4f4f4", border: "1px solid #ddd" }}>
              {missing.length}
            </span>
          </div>
        </div>

        {missing.length === 0 ? (
          <div style={{ marginTop: 8, color: "#666" }}>✅ Nadie pendiente ahora mismo.</div>
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nombre</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Rol</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((m) => (
                  <tr key={m.worker_id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", fontWeight: 900 }}>{m.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{m.role}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>{m.reason || "shift_now"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
              Esto se basa en los horarios (shift_rules). En el siguiente paso añadimos “grace” y penalizaciones.
            </div>
          </div>
        )}
      </div>

      {/* ✅ Resumen */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          ONLINE: <b>{counts.online}</b>
        </div>
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          PAUSA: <b>{counts.pause}</b>
        </div>
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          BAÑO: <b>{counts.bathroom}</b>
        </div>
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 10 }}>
          OFFLINE: <b>{counts.offline}</b>
        </div>
      </div>

      {/* Tabla presencia */}
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
            {shownRows.map((r) => (
              <tr key={r.worker_id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", fontWeight: 800 }}>{r.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.role}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{badge(r.state)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>{fmtDateTime(r.last_change_at)}</td>
              </tr>
            ))}

            {shownRows.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, color: "#666" }}>
                  No hay conectados ahora mismo.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>Se refresca cada 5 segundos.</div>
      </div>
    </div>
  );
}
