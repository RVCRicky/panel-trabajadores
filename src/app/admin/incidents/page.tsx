"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Incident = {
  id: string;
  incident_date: string | null;
  month_date: string | null;
  kind: string | null;
  incident_type: string | null;
  status: "pending" | "justified" | "unjustified" | string | null;
  minutes_late: number | null;
  penalty_eur: number | null;
  notes: string | null;
  worker_id: string | null;
  worker_name: string | null;
};

type ListResp = {
  ok: boolean;
  error?: string;
  month_date: string | null;
  months: string[];
  workers: Array<{ id: string; display_name: string }>;
  items: Incident[];
};

function euro(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

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
  if (s === "justified") return pill("JUSTIFICADA", "#eaffea");
  if (s === "unjustified") return pill("NO JUST.", "#fff3f3");
  return pill((st || "—").toUpperCase(), "#f4f4f4");
}

function badgeKind(k: string | null) {
  const s = String(k || "").toLowerCase();
  if (s === "late") return pill("RETRASO", "#e8f4ff");
  if (s === "absence") return pill("AUSENCIA", "#fff3f3");
  if (s === "call") return pill("LLAMADA", "#f4f4f4");
  return pill((k || "—").toUpperCase(), "#f4f4f4");
}

function formatMonthLabel(isoMonthDate: string) {
  const [y, m] = String(isoMonthDate || "").split("-");
  const monthNum = Number(m);
  const yearNum = Number(y);
  if (!monthNum || !yearNum) return isoMonthDate;
  const date = new Date(yearNum, monthNum - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

export default function AdminIncidentsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [data, setData] = useState<ListResp | null>(null);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [filterWorker, setFilterWorker] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const [actingId, setActingId] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load(month?: string | null) {
    setErr(null);
    setOkMsg(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const m = month ?? selectedMonth ?? null;

      const qs = new URLSearchParams();
      if (m) qs.set("month_date", m);
      if (filterWorker) qs.set("worker_id", filterWorker);
      if (filterStatus) qs.set("status", filterStatus);

      const res = await fetch(`/api/admin/incidents/list?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = (await res.json().catch(() => null)) as ListResp | null;
      if (!j?.ok) {
        setErr(j?.error || "Error cargando incidencias");
        return;
      }

      setData(j);
      if (j.month_date && j.month_date !== selectedMonth) setSelectedMonth(j.month_date);
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

      const res = await fetch("/api/admin/incidents/action", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error aplicando acción");
        return;
      }

      setOkMsg("✅ Guardado");
      await load(selectedMonth);
    } catch (e: any) {
      setErr(e?.message || "Error aplicando acción");
    } finally {
      setActingId(null);
    }
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    load(selectedMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, filterWorker, filterStatus]);

  const months = data?.months || [];
  const workers = data?.workers || [];
  const items = data?.items || [];

  const summary = useMemo(() => {
    const total = items.length;
    const pending = items.filter((x) => x.status === "pending").length;
    const justified = items.filter((x) => x.status === "justified").length;
    const unjustified = items.filter((x) => x.status === "unjustified").length;
    const penalty = items.reduce((acc, x) => acc + (Number(x.penalty_eur) || 0), 0);
    return { total, pending, justified, unjustified, penalty };
  }, [items]);

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Incidencias (mes completo)</h1>

      <div style={{ color: "#666", marginTop: 6 }}>
        Ver y gestionar incidencias de todo el mes. Puedes filtrar por tarotista y por estado.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <button
          onClick={() => load(selectedMonth)}
          disabled={loading}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 900, color: "#666" }}>Mes:</span>
          <select
            value={selectedMonth || data?.month_date || ""}
            onChange={(e) => setSelectedMonth(e.target.value || null)}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 220 }}
            disabled={months.length === 0}
          >
            {months.length === 0 ? <option value="">—</option> : months.map((m) => <option key={m} value={m}>{formatMonthLabel(m)}</option>)}
          </select>

          <span style={{ fontWeight: 900, color: "#666" }}>Tarotista:</span>
          <select
            value={filterWorker}
            onChange={(e) => setFilterWorker(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 240 }}
          >
            <option value="">Todas</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.display_name}
              </option>
            ))}
          </select>

          <span style={{ fontWeight: 900, color: "#666" }}>Estado:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 200 }}
          >
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="justified">Justificada</option>
            <option value="unjustified">No justificada</option>
          </select>
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>Total:</b> {summary.total}
        </div>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>Pendientes:</b> {summary.pending}
        </div>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>Justificadas:</b> {summary.justified}
        </div>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>No justificadas:</b> {summary.unjustified}
        </div>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>Penalización:</b> {euro(summary.penalty)}
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
          {err}
        </div>
      ) : null}

      {okMsg ? (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#eaffea", border: "1px solid #c6f6c6" }}>
          {okMsg}
        </div>
      ) : null}

      <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Tarotista</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Fecha</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Tipo</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>Min tarde</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>€</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Estado</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Notas</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 12, color: "#666" }}>
                  Sin incidencias para este filtro.
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const name = it.worker_name || it.worker_id?.slice(0, 8) || "—";
                const date = it.incident_date || it.month_date || "—";
                const minLate = it.minutes_late ?? 0;
                const pen = Number(it.penalty_eur) || 0;

                return (
                  <tr key={it.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", fontWeight: 900 }}>{name}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{date}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{badgeKind(it.kind || it.incident_type)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{minLate}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>
                      {pen ? euro(pen) : "—"}
                    </td>
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
        * “Quitar” = deja de molestar en el listado (la marcamos como <b>justified</b> sin penalizar).
      </div>
    </div>
  );
}
