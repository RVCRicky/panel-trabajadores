"use client";

import { useEffect, useMemo, useState } from "react";
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

type Incident = {
  id: string;
  worker_id: string;
  incident_date: string | null;
  month_date: string | null;
  kind: string | null;
  incident_type: string | null;
  minutes_late: number | null;
  status: string;
  penalty_eur: number | null;
  notes: string | null;
  created_at: string;
  worker: null | { id: string; display_name: string; role: string };
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

function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

export default function AdminPresencePage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingInc, setLoadingInc] = useState(false);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadPresence() {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/admin/presence/live?show=all", {
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

  async function loadIncidents() {
    setErr(null);
    setLoadingInc(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/admin/incidents/pending", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "Error incidents");
      setIncidents(j.incidents || []);
    } catch (e: any) {
      setErr(e?.message || "Error incidents");
    } finally {
      setLoadingInc(false);
    }
  }

  async function resolveIncident(incident_id: string, action: "justified" | "unjustified") {
    setErr(null);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      let penalty_eur: number | undefined = undefined;
      if (action === "unjustified") {
        const v = prompt("Penalización (€) para NO JUSTIFICADA:", "0");
        penalty_eur = Number(v || "0") || 0;
      }

      const res = await fetch("/api/admin/incidents/resolve", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ incident_id, action, penalty_eur }),
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "Error resolviendo incidencia");

      // quitarla de la lista al resolver
      setIncidents((prev) => prev.filter((x) => x.id !== incident_id));
    } catch (e: any) {
      setErr(e?.message || "Error resolviendo incidencia");
    }
  }

  useEffect(() => {
    loadPresence();
    loadIncidents();
    const t = setInterval(() => {
      loadPresence();
      loadIncidents();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlineOnly = useMemo(() => rows.filter((r) => r.state !== "offline"), [rows]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Presencia + Incidencias</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>

        <button
          onClick={() => {
            loadPresence();
            loadIncidents();
          }}
          disabled={loading || loadingInc}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 800 }}
        >
          {(loading || loadingInc) ? "Actualizando..." : "Actualizar"}
        </button>

        <span style={{ color: "#666", alignSelf: "center" }}>Auto-refresh cada 5s</span>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>{err}</div>
      ) : null}

      {/* INCIDENCIAS PENDIENTES */}
      <div style={{ border: "1px solid #111", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900 }}>Incidencias pendientes</div>
            <div style={{ color: "#666", marginTop: 4 }}>
              Aquí es donde marcas <b>Justificada</b> o <b>No justificada</b>.
            </div>
          </div>
          <div style={{ fontWeight: 900 }}>
            Total: {incidents.length}
          </div>
        </div>

        {incidents.length === 0 ? (
          <div style={{ marginTop: 10, color: "#666" }}>No hay incidencias pendientes ahora mismo.</div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Persona</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Tipo</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>Min tarde</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Notas</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr key={i.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", fontWeight: 900 }}>
                      {i.worker?.display_name || i.worker_id}
                      <div style={{ color: "#777", fontWeight: 600, fontSize: 12 }}>{i.worker?.role || ""}</div>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>
                      {(i.incident_type || i.kind || "—").toString()}
                      <div style={{ color: "#777", fontSize: 12 }}>
                        {i.incident_date ? `Fecha: ${i.incident_date}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>
                      {Number(i.minutes_late || 0)}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", color: "#555" }}>
                      {i.notes || "—"}
                      <div style={{ color: "#999", fontSize: 12 }}>
                        {new Date(i.created_at).toLocaleString("es-ES")}
                      </div>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() => resolveIncident(i.id, "justified")}
                          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #1a7f37", fontWeight: 900 }}
                        >
                          ✅ Justificada
                        </button>
                        <button
                          onClick={() => resolveIncident(i.id, "unjustified")}
                          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #c00", fontWeight: 900 }}
                        >
                          ❌ No justificada
                        </button>
                      </div>
                      <div style={{ color: "#777", fontSize: 12, marginTop: 6 }}>
                        No justificada te pedirá penalización (€).
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* PRESENCIA */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>
          Presencia en directo (solo online/pause/baño): {onlineOnly.length}
        </div>

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
            {onlineOnly.map((r) => (
              <tr key={r.worker_id}>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", fontWeight: 800 }}>{r.name}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.role}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{badge(r.state)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>
                  {new Date(r.last_change_at).toLocaleString("es-ES")}
                </td>
              </tr>
            ))}
            {onlineOnly.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 10, color: "#666" }}>
                  No hay nadie online ahora.
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
