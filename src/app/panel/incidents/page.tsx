"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/Badge";

function useIsMobile(bp = 900) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [bp]);

  return isMobile;
}

function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function formatMonthLabel(isoMonthDate: string) {
  if (!isoMonthDate) return "—";
  const [y, m] = isoMonthDate.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function isoToNiceDate(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

type Item = {
  id: string;
  incident_date: string | null;
  month_date: string | null;
  kind: string | null;
  incident_type: string | null;
  status: string | null; // pending / justified / unjustified
  minutes_late: number | null;
  penalty_eur: number | null;
  notes: string | null;
};

type ApiResp = {
  ok: boolean;
  error?: string;
  month_date: string | null;
  months?: string[];
  items?: Item[];
  totals?: { penalty_eur?: number; count?: number };
};

function statusBadge(st: any) {
  const s = String(st || "").toLowerCase();
  if (s === "unjustified") return { text: "NO JUSTIFICADA", tone: "bad" as any };
  if (s === "justified") return { text: "JUSTIFICADA", tone: "ok" as any };
  if (s === "pending") return { text: "PENDIENTE", tone: "warn" as any };
  if (!s) return { text: "—", tone: "neutral" as any };
  return { text: s.toUpperCase(), tone: "neutral" as any };
}

function typeLabel(it: Item) {
  const v = it.kind || it.incident_type || "—";
  return String(v || "—");
}

export default function PanelIncidentsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

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

      const j = (await res.json().catch(() => null)) as ApiResp | null;

      if (!res.ok || !j?.ok) {
        setErr(j?.error || `Error HTTP ${res.status}`);
        return;
      }

      setMonths(Array.isArray(j.months) ? j.months : []);
      setMonth(j.month_date || null);

      const list = Array.isArray(j.items) ? j.items : [];
      setItems(list);

      setTotalPenalty(Number(j?.totals?.penalty_eur || 0));
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

  const kpis = useMemo(() => {
    const count = items.length;
    const pending = items.filter((x) => String(x.status || "").toLowerCase() === "pending").length;
    const justified = items.filter((x) => String(x.status || "").toLowerCase() === "justified").length;
    const unjustified = items.filter((x) => String(x.status || "").toLowerCase() === "unjustified").length;

    const mins = items.reduce((acc, x) => acc + (Number(x.minutes_late) || 0), 0);
    const penalty = items.reduce((acc, x) => acc + (Number(x.penalty_eur) || 0), 0);

    return { count, pending, justified, unjustified, mins, penalty };
  }, [items]);

  const cardShell: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
  };

  const btnBase: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111",
    fontWeight: 1100,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const btnGhost: React.CSSProperties = { ...btnBase };

  const monthBox: React.CSSProperties = {
    padding: 12,
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fff",
    width: "100%",
  };

  const mobileCard: React.CSSProperties = {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    background: "#fff",
    padding: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
  };

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1160 }}>
      {/* Header premium */}
      <div style={{ ...cardShell, padding: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 1300, fontSize: 20, lineHeight: 1.1 }}>⚠️ Mis incidencias</div>
            <div style={{ color: "#6b7280", fontWeight: 900 }}>
              Incidencias del mes + penalización (solo cuentan las no justificadas).
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
            <button
              onClick={() => load(month)}
              disabled={loading}
              style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}
            >
              {loading ? "Actualizando…" : "Actualizar"}
            </button>

            <a
              href="/panel"
              style={{
                ...btnGhost,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ← Volver
            </a>
          </div>
        </div>

        {/* Mes + KPIs */}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "420px 1fr", gap: 12 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Mes</div>
            <select
              value={month || ""}
              onChange={(e) => setMonth(e.target.value || null)}
              disabled={loading || months.length === 0}
              style={{ ...monthBox, fontWeight: 1100 }}
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

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
              <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Incidencias</div>
              <div style={{ fontWeight: 1400, fontSize: 18, marginTop: 4 }}>{kpis.count}</div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
              <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Pendientes</div>
              <div style={{ fontWeight: 1400, fontSize: 18, marginTop: 4 }}>{kpis.pending}</div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
              <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>No justificadas</div>
              <div style={{ fontWeight: 1400, fontSize: 18, marginTop: 4 }}>{kpis.unjustified}</div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
              <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Penalización</div>
              <div style={{ fontWeight: 1500, fontSize: 18, marginTop: 4, color: totalPenalty > 0 ? "#b91c1c" : "#111" }}>
                {eur(totalPenalty)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {err ? (
        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 900 }}>
          {err}
        </div>
      ) : null}

      {/* LISTADO */}
      <div style={{ ...cardShell, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontWeight: 1200 }}>Listado</div>
          <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
            {month ? `Mes: ${formatMonthLabel(month)}` : "—"}
          </div>
        </div>

        {/* ✅ MÓVIL: tarjetas */}
        {isMobile ? (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {items.length === 0 ? (
              <div style={{ color: "#6b7280", fontWeight: 900 }}>No hay incidencias en este mes.</div>
            ) : (
              items.map((it) => {
                const st = statusBadge(it.status);
                const penalty = Number(it.penalty_eur) || 0;

                return (
                  <div key={it.id} style={mobileCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 1300 }}>{isoToNiceDate(it.incident_date)}</div>
                      <Badge tone={st.tone}>{st.text}</Badge>
                    </div>

                    <div style={{ marginTop: 8, fontWeight: 1100 }}>{typeLabel(it)}</div>

                    <div
                      style={{
                        marginTop: 10,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 10,
                      }}
                    >
                      <div style={{ border: "1px solid #f3f4f6", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                        <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Minutos</div>
                        <div style={{ fontWeight: 1400, marginTop: 2 }}>{it.minutes_late ?? "—"}</div>
                      </div>

                      <div style={{ border: "1px solid #f3f4f6", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                        <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Penalización</div>
                        <div style={{ fontWeight: 1500, marginTop: 2, color: penalty > 0 ? "#b91c1c" : "#111" }}>
                          {eur(penalty)}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Notas</div>
                      <div style={{ marginTop: 4, fontWeight: it.notes ? 900 : 800, color: it.notes ? "#111" : "#6b7280", whiteSpace: "pre-wrap" }}>
                        {it.notes || "—"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 1200 }}>
                <span>Total penalización del mes</span>
                <span style={{ color: totalPenalty > 0 ? "#b91c1c" : "#111" }}>{eur(totalPenalty)}</span>
              </div>

              <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
                * Solo cuentan las incidencias <b>NO JUSTIFICADAS</b>.
              </div>
            </div>
          </div>
        ) : (
          /* ✅ DESKTOP: tabla */
          <div style={{ marginTop: 10, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
              <thead>
                <tr>
                  <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>Fecha</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>Tipo</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>Estado</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb", textAlign: "right" }}>Min</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb", textAlign: "right" }}>€</th>
                  <th style={{ padding: 10, borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>Notas</th>
                </tr>
              </thead>

              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, color: "#6b7280", fontWeight: 900 }}>
                      No hay incidencias en este mes.
                    </td>
                  </tr>
                ) : (
                  items.map((it) => {
                    const st = statusBadge(it.status);
                    const penalty = Number(it.penalty_eur) || 0;

                    return (
                      <tr key={it.id}>
                        <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", fontWeight: 1000 }}>
                          {isoToNiceDate(it.incident_date)}
                        </td>

                        <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                          <div style={{ fontWeight: 1100 }}>{typeLabel(it)}</div>
                          {it.month_date ? (
                            <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12, marginTop: 4 }}>
                              Mes: {formatMonthLabel(it.month_date)}
                            </div>
                          ) : null}
                        </td>

                        <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                          <Badge tone={st.tone}>{st.text}</Badge>
                        </td>

                        <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", textAlign: "right", fontWeight: 1100 }}>
                          {it.minutes_late ?? "—"}
                        </td>

                        <td
                          style={{
                            padding: 10,
                            borderBottom: "1px solid #f3f4f6",
                            textAlign: "right",
                            fontWeight: 1300,
                            color: penalty > 0 ? "#b91c1c" : "#111",
                          }}
                        >
                          {eur(penalty)}
                        </td>

                        <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                          <div style={{ color: it.notes ? "#111" : "#6b7280", fontWeight: it.notes ? 900 : 800, whiteSpace: "pre-wrap" }}>
                            {it.notes || "—"}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>

              <tfoot>
                <tr>
                  <td colSpan={4} style={{ padding: 10, borderTop: "1px solid #e5e7eb", fontWeight: 1200, color: "#111" }}>
                    Total penalización del mes
                  </td>
                  <td
                    style={{
                      padding: 10,
                      borderTop: "1px solid #e5e7eb",
                      textAlign: "right",
                      fontWeight: 1500,
                      color: totalPenalty > 0 ? "#b91c1c" : "#111",
                    }}
                  >
                    {eur(totalPenalty)}
                  </td>
                  <td style={{ padding: 10, borderTop: "1px solid #e5e7eb" }} />
                </tr>
              </tfoot>
            </table>

            <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
              * Solo cuentan las incidencias marcadas como <b>NO JUSTIFICADAS</b>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
