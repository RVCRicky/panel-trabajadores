"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Incident = {
  id: string;
  incident_date: string | null;
  month_date: string | null;
  kind: string | null;
  incident_type: string | null;
  status: "pending" | "resolved" | "cancelled" | string | null;
  minutes_late: number | null;
  penalty_eur: number | null;
  notes: string | null;

  worker_id: string | null;
  worker_name: string | null; // el endpoint puede devolverlo ya “bonito”
};

function pill(text: string, bg: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 999,
        fontWeight: 900,
        border: "1px solid #ddd",
        fontSize: 12,
        background: bg,
      }}
    >
      {text}
    </span>
  );
}

function badgeStatus(st: string | null) {
  const s = String(st || "").toLowerCase();
  if (s === "pending") return pill("PENDIENTE", "#fff6dd");
  if (s === "resolved") return pill("RESUELTA", "#eaffea");
  if (s === "cancelled") return pill("ANULADA", "#f4f4f4");
  return pill((st || "—").toUpperCase(), "#f4f4f4");
}

function badgeKind(k: string | null) {
  const s = String(k || "").toLowerCase();
  if (s === "late") return pill("RETRASO", "#e8f4ff");
  if (s === "absence") return pill("AUSENCIA", "#fff3f3");
  return pill((k || "—").toUpperCase(), "#f4f4f4");
}

export default function AdminIncidentsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [items, setItems] = useState<Incident[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load() {
    setErr(null);
    setOkMsg(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      // Endpoint que ya construimos: lista pendientes
      const res = await fetch("/api/admin/incidents/pending", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error cargando incidencias");
        return;
      }

      setItems((j.items || j.rows || []) as Incident[]);
    } catch (e: any) {
      setErr(e?.message || "Error cargando incidencias");
    } finally {
      setLoading(false);
    }
  }

  async function action(id: string, action: "justified" | "unjustified" | "dismiss") {
    setErr(null);
    setOkMsg(null);
    setActingId(id);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      // Endpoint: resolver/justificar/anular
      const res = await fetch("/api/admin/incidents/action", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, action }),
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error aplicando acción");
        return;
      }

      setOkMsg("✅ Guardado");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Error aplicando acción");
    } finally {
      setActingId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Incidencias</h1>
      <div style={{ color: "#666", marginTop: 6 }}>
        Aquí aparecen las incidencias <b>pendientes</b> detectadas por turnos (gente que debía estar online y no lo estaba).
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 10,
            background: "#fff3f3",
            border: "1px solid #ffcccc",
          }}
        >
          {err}
        </div>
      ) : null}

      {okMsg ? (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 10,
            background: "#eaffea",
            border: "1px solid #c6f6c6",
          }}
        >
          {okMsg}
        </div>
      ) : null}

      <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Trabajador</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Fecha</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Tipo</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>Min tarde</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Estado</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Notas</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 12, color: "#666" }}>
                  No hay incidencias pendientes.
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const name = it.worker_name || it.worker_id?.slice(0, 8) || "—";
                const date = it.incident_date || it.month_date || "—";
                const minLate = it.minutes_late ?? 0;

                return (
                  <tr key={it.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", fontWeight: 900 }}>{name}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{date}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{badgeKind(it.kind || it.incident_type)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{minLate}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{badgeStatus(it.status)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", color: "#666", maxWidth: 360 }}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{it.notes || "—"}</div>
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button
                          disabled={actingId === it.id}
                          onClick={() => action(it.id, "justified")}
                          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontWeight: 900 }}
                        >
                          Justificada
                        </button>

                        <button
                          disabled={actingId === it.id}
                          onClick={() => action(it.id, "unjustified")}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid #111",
                            background: "#111",
                            color: "#fff",
                            fontWeight: 900,
                          }}
                        >
                          No justificada
                        </button>

                        <button
                          disabled={actingId === it.id}
                          onClick={() => action(it.id, "dismiss")}
                          style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", fontWeight: 900, color: "#666" }}
                        >
                          Quitar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
        * “Quitar” = marca la incidencia como anulada (para que no vuelva a salir como pendiente).
      </div>
    </div>
  );
}
