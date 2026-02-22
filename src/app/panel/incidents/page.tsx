// src/app/panel/incidents/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";

function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function formatMonthLabel(isoMonthDate: string) {
  if (!isoMonthDate) return "—";
  const [y, m] = isoMonthDate.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });
}

type Item = {
  id: string;
  incident_date: string | null;
  month_date: string | null;
  kind: string | null;
  incident_type: string | null;
  status: string | null;
  minutes_late: number | null;
  penalty_eur: number | null;
  notes: string | null;
};

export default function PanelIncidentsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [totalPenalty, setTotalPenalty] = useState(0);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load(monthOverride?: string | null) {
    setErr(null);
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const m = monthOverride ?? month ?? null;
      const qs = m ? `?month_date=${encodeURIComponent(m)}` : "";

      const res = await fetch(`/api/incidents/me${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setErr(data?.error || `Error HTTP ${res.status}`);
        return;
      }

      setMonths(data.months || []);
      setMonth(data.month_date || null);
      setItems(data.items || []);
      setTotalPenalty(Number(data?.totals?.penalty_eur || 0));
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
    if (!month) return;
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1200 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Mis incidencias</h1>

        <a
          href="/panel"
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
          }}
        >
          ← Volver al panel
        </a>

        <button
          onClick={() => load(month)}
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            fontWeight: 900,
          }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {err && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid #ffcccc",
            background: "#fff3f3",
          }}
        >
          {err}
        </div>
      )}

      <Card>
        <CardTitle>Penalización del mes</CardTitle>
        <CardValue>{eur(totalPenalty)}</CardValue>
        <CardHint>Solo cuentan las incidencias no justificadas.</CardHint>
      </Card>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 900 }}>Mes:</div>
        <select
          value={month || ""}
          onChange={(e) => setMonth(e.target.value || null)}
          disabled={loading || months.length === 0}
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ddd",
            maxWidth: 420,
          }}
        >
          {months.length === 0 ? (
            <option value="">{month || "—"}</option>
          ) : (
            months.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))
          )}
        </select>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "left" }}>Fecha</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "left" }}>Tipo</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "left" }}>Estado</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "right" }}>Min</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "right" }}>€</th>
              <th style={{ padding: 10, borderBottom: "1px solid #eee", textAlign: "left" }}>Notas</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: "#666" }}>
                  No hay incidencias en este mes.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>
                    {it.incident_date || "—"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>
                    {it.kind || it.incident_type || "—"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>
                    {it.status || "—"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    {it.minutes_late ?? "—"}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>
                    {eur(it.penalty_eur || 0)}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>
                    {it.notes || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
