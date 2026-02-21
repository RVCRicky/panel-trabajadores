"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Incident = {
  id: string;
  month_date: string | null;
  incident_date: string | null;
  kind: string | null;
  incident_type: string | null;
  status: "pending" | "justified" | "unjustified" | string | null;
  minutes_late: number | null;
  penalty_eur: number | null;
  notes: string | null;
  created_at: string | null;
};

type Resp = {
  ok: boolean;
  error?: string;
  month_date: string | null;
  months: string[];
  me: { id: string; display_name: string };
  items: Incident[];
  summary: { total: number; pending: number; justified: number; unjustified: number; penalty_eur: number };
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

export default function MyIncidentsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [data, setData] = useState<Resp | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load(month?: string | null) {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const m = month ?? selectedMonth ?? null;
      const qs = m ? `?month_date=${encodeURIComponent(m)}` : "";

      const res = await fetch(`/api/incidents/my${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = (await res.json().catch(() => null)) as Resp | null;
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

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    load(selectedMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  const items = data?.items || [];
  const months = data?.months || [];

  const summary = data?.summary || { total: 0, pending: 0, justified: 0, unjustified: 0, penalty_eur: 0 };

  const title = useMemo(() => {
    const name = data?.me?.display_name || "Mi panel";
    return `Incidencias · ${name}`;
  }, [data?.me?.display_name]);

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>{title}</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
        <a href="/panel" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver al panel
        </a>

        <button
          onClick={() => load(selectedMonth)}
          disabled={loading}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <span style={{ color: "#666", fontWeight: 900 }}>Mes:</span>
        <select
          value={selectedMonth || data?.month_date || ""}
          onChange={(e) => setSelectedMonth(e.target.value || null)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 220 }}
          disabled={months.length === 0}
        >
          {months.length === 0 ? <option value="">—</option> : months.map((m) => <option key={m} value={m}>{formatMonthLabel(m)}</option>)}
        </select>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
          {err}
        </div>
      ) : null}

      {/* Resumen */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>Total:</b> {summary.total}
        </div>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>Pendientes:</b> {summary.pending}
        </div>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>No justificadas:</b> {summary.unjustified}
        </div>
        <div style={{ padding: 10, borderRadius: 12, border: "1px solid #eee", background: "#fff" }}>
          <b>Penalización:</b> {euro(summary.penalty_eur)}
        </div>
      </div>

      <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Fecha</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Tipo</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>Min tarde</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 10 }}>€</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Estado</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Notas</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: "#666" }}>
                  No tienes incidencias en este mes.
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const date = it.incident_date || it.month_date || "—";
                const minLate = it.minutes_late ?? 0;
                const pen = Number(it.penalty_eur) || 0;

                return (
                  <tr key={it.id}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{date}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{badgeKind(it.kind || it.incident_type)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{minLate}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>
                      {pen ? euro(pen) : "—"}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{badgeStatus(it.status)}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", color: "#666", maxWidth: 420 }}>
                      <div style={{ whiteSpace: "pre-wrap" }}>{it.notes || "—"}</div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
        * Solo Admin puede marcar justificadas / no justificadas.
      </div>
    </div>
  );
}
