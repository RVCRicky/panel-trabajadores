"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { QuickLink } from "@/components/ui/QuickLink";
import { MiniBarChart } from "@/components/charts/MiniBarChart";

type WorkerRole = "admin" | "central" | "tarotista";

type MeOk = {
  ok: true;
  userId: string;
  worker: null | {
    id: string;
    role: WorkerRole;
    display_name: string;
    is_active: boolean;
  };
};
type MeErr = { ok: false; error: string };
type MeResp = MeOk | MeErr;

function fmt(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES");
}

function formatMonthLabel(isoMonthDate: string) {
  const [y, m] = String(isoMonthDate || "").split("-");
  const monthNum = Number(m);
  const yearNum = Number(y);
  if (!monthNum || !yearNum) return isoMonthDate;
  const date = new Date(yearNum, monthNum - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

type OverviewResp = {
  ok: boolean;
  error?: string;

  month_date: string | null;
  months: string[];

  totals: { minutes: number; captadas: number; tarotistas: number };

  top: {
    minutes: Array<{ worker_id: string; name: string; minutes: number; captadas: number; cliente_pct: number; repite_pct: number }>;
    captadas: Array<{ worker_id: string; name: string; minutes: number; captadas: number; cliente_pct: number; repite_pct: number }>;
    cliente_pct: Array<{ worker_id: string; name: string; minutes: number; captadas: number; cliente_pct: number; repite_pct: number }>;
    repite_pct: Array<{ worker_id: string; name: string; minutes: number; captadas: number; cliente_pct: number; repite_pct: number }>;
  };

  presence: { online: number; pause: number; bathroom: number; offline: number; total: number };
  incidents: { pending: number };

  cronLogs: Array<{
    id: number;
    job: string;
    ok: boolean;
    details: any;
    started_at: string;
    finished_at: string | null;
  }>;

  // minutos por día
  dailySeries: Array<{ date: string; minutes: number }>;

  // captadas por día (soportamos varios nombres para no romper)
  dailyCaptadasSeries?: Array<{ date: string; captadas: number }>;
  captadasDailySeries?: Array<{ date: string; captadas: number }>;
  dailySeriesCaptadas?: Array<{ date: string; captadas: number }>;
};

type ChartMode = "minutes" | "captadas";

function clamp(n: number, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
}

function pctColor(p: number) {
  if (p >= 85) return "#10b981"; // verde
  if (p >= 65) return "#f59e0b"; // amarillo
  return "#ef4444"; // rojo
}

function pillStyle() {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    fontSize: 12,
    color: "#374151",
    fontWeight: 800,
  } as React.CSSProperties;
}

export default function AdminPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [overview, setOverview] = useState<OverviewResp | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const [chartMode, setChartMode] = useState<ChartMode>("minutes");

  // Sync CSV
  const [csvUrl, setCsvUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncDebug, setSyncDebug] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // ✅ Comprueba admin
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json().catch(() => null)) as MeResp | null;

      if (!json?.ok) return setStatus(`Error /api/me: ${(json as any)?.error || "UNKNOWN"}`);
      if (!json.worker) return setStatus("No tienes perfil en workers.");
      if (!json.worker.is_active) return setStatus("Usuario desactivado.");
      if (json.worker.role !== "admin") return router.replace("/panel");

      setMeName(json.worker.display_name);
      setStatus("OK");
    })();
  }, [router]);

  async function loadOverview(monthOverride?: string | null) {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const month = monthOverride ?? selectedMonth ?? null;
      const qs = month ? `?month_date=${encodeURIComponent(month)}` : "";

      const r = await fetch(`/api/admin/dashboard/overview${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = (await r.json().catch(() => null)) as OverviewResp | null;
      if (!j?.ok) {
        setErr(j?.error || `Error overview (HTTP ${r.status})`);
        return;
      }

      setOverview(j);

      if (j.month_date && j.month_date !== selectedMonth) setSelectedMonth(j.month_date);

      // si no viene captadas por día, fuerza modo minutes para no quedar vacío
      const cap = (j.dailyCaptadasSeries || j.captadasDailySeries || j.dailySeriesCaptadas || []) as any[];
      if ((!cap || cap.length === 0) && chartMode === "captadas") setChartMode("minutes");
    } catch (e: any) {
      setErr(e?.message || "Error overview");
    } finally {
      setLoading(false);
    }
  }

  // carga inicial + refresco cada 30s
  useEffect(() => {
    if (status !== "OK") return;
    loadOverview(null);
    const t = setInterval(() => loadOverview(selectedMonth), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // si cambia el mes manualmente
  useEffect(() => {
    if (status !== "OK") return;
    if (!selectedMonth) return;
    if (overview?.month_date === selectedMonth) return;
    loadOverview(selectedMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  async function runSync() {
    setSyncMsg(null);
    setSyncDebug(null);
    setSyncing(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/admin/sync-csv", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ csvUrl: csvUrl.trim() }),
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }

      setSyncDebug(raw || "(respuesta vacía)");

      if (!r.ok || !j?.ok) {
        setSyncMsg(`Error HTTP ${r.status}. ${j?.error || raw || "(vacío)"}`);
        return;
      }

      setSyncMsg(
        `✅ Sync OK. Insertadas: ${j.inserted}. Saltadas sin worker: ${j.skippedNoWorker}. Filas malas: ${j.skippedBad}. Total CSV: ${j.totalRows}`
      );

      await loadOverview(selectedMonth);
    } finally {
      setSyncing(false);
    }
  }

  const months = overview?.months || [];
  const monthLabel = overview?.month_date ? formatMonthLabel(overview.month_date) : "—";

  const presence = overview?.presence || null;
  const pending = overview?.incidents?.pending ?? null;

  const toneOnline = (presence?.online ?? 0) > 0 ? "ok" : "neutral";
  const tonePending = (pending ?? 0) > 0 ? "warn" : "ok";

  const lastCron = useMemo(() => {
    const logs = overview?.cronLogs || [];
    return logs.length ? logs[0] : null;
  }, [overview?.cronLogs]);

  const cronInfo = useMemo(() => {
    if (!lastCron) return { tone: "neutral", text: "Sin logs", dur: "—", when: "—" };
    const tone = lastCron.ok ? "ok" : "warn";
    const text = lastCron.ok ? "OK" : "FAIL";
    const dur = lastCron.details?.duration_ms != null ? `${fmt(lastCron.details.duration_ms)} ms` : "—";
    const when = lastCron.started_at ? new Date(lastCron.started_at).toLocaleString("es-ES") : "—";
    return { tone, text, dur, when };
  }, [lastCron]);

  const dailyMinutesData = useMemo(() => {
    return (overview?.dailySeries || []).map((x) => ({
      date: x.date,
      value: Number((x as any).minutes) || 0,
    }));
  }, [overview?.dailySeries]);

  const dailyCaptadasData = useMemo(() => {
    const src =
      (overview?.dailyCaptadasSeries ||
        overview?.captadasDailySeries ||
        overview?.dailySeriesCaptadas ||
        []) as Array<any>;

    return (src || []).map((x) => ({
      date: String(x.date),
      value: Number(x.captadas) || 0,
    }));
  }, [overview?.dailyCaptadasSeries, overview?.captadasDailySeries, overview?.dailySeriesCaptadas]);

  const chartData = chartMode === "minutes" ? dailyMinutesData : dailyCaptadasData;
  const chartUnit = chartMode === "minutes" ? "min" : "cap";

  // ==========
  // UI PRO: Top3 + Alertas accionables
  // ==========

  const topMinutes = useMemo(() => {
    const list = overview?.top?.minutes || [];
    return list.slice(0, 3);
  }, [overview?.top?.minutes]);

  const maxTopMinutes = useMemo(() => {
    return Math.max(1, ...(topMinutes.map((x) => Number(x.minutes) || 0) || [1]));
  }, [topMinutes]);

  // KPI didáctico: ritmo del mes basado en serie diaria (solo informativo)
  const kpiMomentum = useMemo(() => {
    const s = overview?.dailySeries || [];
    if (s.length < 6) return { tone: "neutral" as const, text: "Sin tendencia", pct: 0 };

    // compara últimos 3 días vs 3 anteriores
    const last3 = s.slice(-3).reduce((a, x) => a + (Number(x.minutes) || 0), 0);
    const prev3 = s.slice(-6, -3).reduce((a, x) => a + (Number(x.minutes) || 0), 0);
    if (prev3 <= 0) return { tone: "neutral" as const, text: "Tendencia estable", pct: 0 };

    const diff = ((last3 - prev3) / prev3) * 100;
    const pct = Math.round(diff);
    if (pct >= 10) return { tone: "ok" as const, text: `Subiendo +${pct}%`, pct };
    if (pct <= -10) return { tone: "warn" as const, text: `Bajando ${pct}%`, pct };
    return { tone: "neutral" as const, text: "Estable", pct };
  }, [overview?.dailySeries]);

  const alerts = useMemo(() => {
    const a: Array<{ tone: "warn" | "ok" | "neutral"; title: string; desc: string; action?: { label: string; href: string } }> = [];

    const p = overview?.presence;
    const pend = overview?.incidents?.pending ?? 0;

    // Incidencias
    if (pend > 0) {
      a.push({
        tone: "warn",
        title: "Incidencias pendientes",
        desc: `${fmt(pend)} por revisar hoy.`,
        action: { label: "Abrir incidencias", href: "/admin/incidents" },
      });
    } else {
      a.push({
        tone: "ok",
        title: "Incidencias",
        desc: "Todo al día.",
      });
    }

    // Presencia
    if (p) {
      const online = p.online || 0;
      const total = p.total || 0;
      const ratio = total > 0 ? Math.round((online / total) * 100) : 0;

      if (online === 0) {
        a.push({
          tone: "warn",
          title: "Presencia",
          desc: "Nadie está ONLINE ahora mismo.",
          action: { label: "Ver presencia", href: "/admin/live" },
        });
      } else if (ratio < 30) {
        a.push({
          tone: "warn",
          title: "Presencia baja",
          desc: `${fmt(online)} ONLINE de ${fmt(total)} (${ratio}%).`,
          action: { label: "Ver presencia", href: "/admin/live" },
        });
      } else {
        a.push({
          tone: "ok",
          title: "Presencia",
          desc: `${fmt(online)} ONLINE (${ratio}%).`,
          action: { label: "Ver detalle", href: "/admin/live" },
        });
      }
    }

    // Cron
    if (cronInfo.text === "FAIL") {
      a.push({
        tone: "warn",
        title: "CRON fallando",
        desc: `Último: FAIL · ${cronInfo.when}`,
      });
    } else if (cronInfo.text === "OK") {
      a.push({
        tone: "ok",
        title: "CRON",
        desc: `OK · ${cronInfo.when}`,
      });
    } else {
      a.push({
        tone: "neutral",
        title: "CRON",
        desc: "Sin logs todavía.",
      });
    }

    // Momentum (tendencia)
    a.push({
      tone: kpiMomentum.tone === "warn" ? "warn" : kpiMomentum.tone === "ok" ? "ok" : "neutral",
      title: "Tendencia de minutos",
      desc: kpiMomentum.text,
    });

    return a.slice(0, 4);
  }, [overview?.presence, overview?.incidents?.pending, cronInfo.text, cronInfo.when, kpiMomentum]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ===== HEADER PRO ===== */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: -0.2 }}>Dashboard Admin</h1>
          <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
            Centro de control: rendimiento, presencia, incidencias y salud del sistema.
          </div>
        </div>

        {/* Selector de mes + estado */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ ...pillStyle(), fontWeight: 900 }}>
            Mes: <span style={{ color: "#111" }}>{monthLabel}</span>
          </span>

          <select
            value={selectedMonth || overview?.month_date || ""}
            onChange={(e) => setSelectedMonth(e.target.value || null)}
            style={{
              padding: 10,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              minWidth: 240,
              background: "#fff",
              fontWeight: 800,
            }}
            disabled={loading || months.length === 0 || status !== "OK"}
          >
            {months.length === 0 ? (
              <option value="">{overview?.month_date || "—"}</option>
            ) : (
              months.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))
            )}
          </select>

          <span style={{ color: "#6b7280", fontSize: 13 }}>
            Estado: <b style={{ color: "#111" }}>{status}</b>
            {status === "OK" ? (
              <>
                {" "}
                · Admin: <b style={{ color: "#111" }}>{meName}</b>
              </>
            ) : null}
          </span>

          <button
            onClick={() => loadOverview(selectedMonth)}
            disabled={loading || status !== "OK"}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #111",
              fontWeight: 900,
              cursor: loading ? "not-allowed" : "pointer",
              background: "#fff",
            }}
          >
            {loading ? "Actualizando..." : "Actualizar"}
          </button>

          <button
            onClick={logout}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ padding: 12, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 12 }}>{err}</div>
      ) : null}

      {/* ===== KPI EXECUTIVE PRO (4 CARDS) ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Producción del mes</CardTitle>
          <CardValue>{overview?.totals ? `${fmt(overview.totals.minutes)} min` : "—"}</CardValue>
          <CardHint>
            Captadas: <b>{overview?.totals ? fmt(overview.totals.captadas) : "—"}</b> · Tarotistas:{" "}
            <b>{overview?.totals ? fmt(overview.totals.tarotistas) : "—"}</b>
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Presencia ahora</CardTitle>
          <CardValue>{presence ? fmt(presence.online) : "—"}</CardValue>
          <CardHint>
            <Badge tone={toneOnline as any}>ONLINE</Badge> · Pausa: <b>{presence ? fmt(presence.pause) : "—"}</b> · Baño:{" "}
            <b>{presence ? fmt(presence.bathroom) : "—"}</b> · Offline: <b>{presence ? fmt(presence.offline) : "—"}</b>
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Incidencias pendientes</CardTitle>
          <CardValue>{pending === null ? "—" : fmt(pending)}</CardValue>
          <CardHint>
            <Badge tone={tonePending as any}>{pending && pending > 0 ? "Revisar" : "OK"}</Badge> · Acciones en /admin/incidents
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Salud del sistema</CardTitle>
          <CardValue>
            <Badge tone={cronInfo.tone as any}>{cronInfo.text}</Badge>
          </CardValue>
          <CardHint>
            Cron: <b>{cronInfo.text}</b> · Duración: <b>{cronInfo.dur}</b> · Último: <b>{cronInfo.when}</b>
          </CardHint>
        </Card>
      </div>

      {/* ===== BLOQUE PRO: TOP 3 + ALERTAS ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Top 3 (Minutos)</CardTitle>
          <CardHint>Lectura rápida del liderazgo del mes. Motiva y te permite actuar.</CardHint>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {topMinutes.length === 0 ? (
              <div style={{ color: "#6b7280" }}>Sin datos.</div>
            ) : (
              topMinutes.map((r, idx) => {
                const v = Number(r.minutes) || 0;
                const w = Math.round((v / maxTopMinutes) * 100);
                const badgeBg = idx === 0 ? "#fef3c7" : idx === 1 ? "#e5e7eb" : "#fee2e2";

                return (
                  <div
                    key={r.worker_id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 10,
                      background: "#fff",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 900,
                            border: "1px solid #e5e7eb",
                            background: badgeBg,
                          }}
                        >
                          {idx + 1}
                        </div>
                        <div>
                          <div style={{ fontWeight: 900 }}>{r.name}</div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            Captadas: <b>{fmt(r.captadas)}</b> · Cliente%: <b>{fmt(r.cliente_pct)}%</b> · Repite%:{" "}
                            <b>{fmt(r.repite_pct)}%</b>
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 900 }}>{fmt(r.minutes)} min</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>Mes</div>
                      </div>
                    </div>

                    <div
                      style={{
                        width: "100%",
                        height: 10,
                        borderRadius: 999,
                        background: "#f3f4f6",
                        border: "1px solid #e5e7eb",
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ width: `${clamp(w)}%`, height: "100%", background: "#111" }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Alertas (Acción)</CardTitle>
          <CardHint>Lo que necesita decisión hoy, sin perderte en tablas.</CardHint>

          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {alerts.map((a, i) => (
              <div
                key={i}
                style={{
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  padding: 10,
                  background: a.tone === "warn" ? "#fff7ed" : a.tone === "ok" ? "#f0fdf4" : "#f9fafb",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{a.title}</div>
                  <Badge tone={(a.tone === "warn" ? "warn" : a.tone === "ok" ? "ok" : "neutral") as any}>
                    {a.tone === "warn" ? "ATENCIÓN" : a.tone === "ok" ? "OK" : "INFO"}
                  </Badge>
                </div>
                <div style={{ fontSize: 13, color: "#374151" }}>{a.desc}</div>

                {a.action ? (
                  <div style={{ marginTop: 4 }}>
                    <button
                      onClick={() => router.push(a.action!.href)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #111",
                        background: "#111",
                        color: "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                        width: "fit-content",
                      }}
                    >
                      {a.action.label}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ===== ACCESOS ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <QuickLink href="/admin/live" title="Presencia" desc="Quién está online / pausa / baño y quién falta." />
        <QuickLink href="/admin/incidents" title="Incidencias" desc="Justificar / No justificar, historial y control." />
        <QuickLink href="/admin/workers" title="Trabajadores" desc="Altas, bajas, roles, activar/desactivar." />
        <QuickLink href="/admin/mappings" title="Mappings" desc="Enlaces de CSV/Drive con trabajadores." />
        <QuickLink href="/admin/invoices" title="Facturas" desc="Ver facturas, añadir extras y sanciones." />
      </div>

      {/* ===== GRÁFICO CON TOGGLE ===== */}
      <Card>
        <CardTitle>Serie diaria</CardTitle>
        <CardHint>Mes seleccionado · Toggle Minutos / Captadas.</CardHint>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <button
            onClick={() => setChartMode("minutes")}
            style={{
              padding: 10,
              borderRadius: 12,
              border: "1px solid #111",
              fontWeight: 900,
              background: chartMode === "minutes" ? "#111" : "#fff",
              color: chartMode === "minutes" ? "#fff" : "#111",
            }}
          >
            Minutos
          </button>

          <button
            onClick={() => setChartMode("captadas")}
            disabled={dailyCaptadasData.length === 0}
            style={{
              padding: 10,
              borderRadius: 12,
              border: "1px solid #111",
              fontWeight: 900,
              background: chartMode === "captadas" ? "#111" : "#fff",
              color: chartMode === "captadas" ? "#fff" : "#111",
              opacity: dailyCaptadasData.length === 0 ? 0.5 : 1,
              cursor: dailyCaptadasData.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Captadas
          </button>

          <div style={{ marginLeft: "auto", color: "#6b7280", display: "flex", alignItems: "center" }}>
            Mostrando:{" "}
            <b style={{ color: "#111", marginLeft: 6 }}>
              {chartMode === "minutes" ? "Minutos/día" : "Captadas/día"}
            </b>
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <MiniBarChart data={chartData} height={180} unit={chartUnit} />
        </div>
      </Card>

      {/* ===== SYNC CSV ===== */}
      <Card>
        <CardTitle>Sincronizar Google Sheets (CSV)</CardTitle>

        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <input
            value={csvUrl}
            onChange={(e) => setCsvUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={runSync}
              disabled={syncing || status !== "OK" || !csvUrl.trim()}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #111",
                background: syncing ? "#eee" : "#111",
                color: syncing ? "#111" : "#fff",
                cursor: syncing ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {syncing ? "Sincronizando..." : "Sync ahora"}
            </button>

            <button
              onClick={() => loadOverview(selectedMonth)}
              disabled={loading || status !== "OK"}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {loading ? "Cargando..." : "Refrescar dashboard"}
            </button>
          </div>

          {syncMsg ? (
            <div style={{ padding: 12, borderRadius: 12, background: "#f9fafb", border: "1px solid #e5e7eb" }}>
              {syncMsg}
            </div>
          ) : null}

          {syncDebug ? (
            <div style={{ padding: 12, borderRadius: 12, background: "#fff", border: "1px solid #e5e7eb" }}>
              <b>DEBUG:</b>
              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{syncDebug}</pre>
            </div>
          ) : null}
        </div>
      </Card>

      {/* ===== TOP TABLES ===== */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
        {[
          { key: "minutes", title: "Top 10 (Minutos)" },
          { key: "captadas", title: "Top 10 (Captadas)" },
          { key: "cliente_pct", title: "Top 10 (Cliente %)" },
          { key: "repite_pct", title: "Top 10 (Repite %)" },
        ].map((box) => {
          const list: any[] = (overview?.top as any)?.[box.key] || [];
          const label = box.key === "minutes" ? "Min" : box.key === "captadas" ? "Cap" : "%";

          return (
            <Card key={box.key}>
              <CardTitle>{box.title}</CardTitle>
              <CardHint>Mes seleccionado.</CardHint>

              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>#</th>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tarotista</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>{label}</th>
                      {box.key === "minutes" ? (
                        <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Cap</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 ? (
                      <tr>
                        <td colSpan={box.key === "minutes" ? 4 : 3} style={{ padding: 10, color: "#6b7280" }}>
                          Sin datos.
                        </td>
                      </tr>
                    ) : (
                      list.map((r: any, idx: number) => (
                        <tr key={r.worker_id}>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{idx + 1}</td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>
                            {box.key === "minutes"
                              ? fmt(r.minutes)
                              : box.key === "captadas"
                              ? fmt(r.captadas)
                              : `${fmt(box.key === "cliente_pct" ? r.cliente_pct : r.repite_pct)} %`}
                          </td>
                          {box.key === "minutes" ? (
                            <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.captadas)}</td>
                          ) : null}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      {/* ===== CRON LOGS ===== */}
      <Card>
        <CardTitle>Últimas ejecuciones CRON</CardTitle>
        <CardHint>Si ves FAIL, revisa Vercel Functions Logs.</CardHint>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Fecha</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Job</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Estado</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Duración</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.cronLogs || []).length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 10, color: "#6b7280" }}>
                    Sin logs aún.
                  </td>
                </tr>
              ) : (
                (overview?.cronLogs || []).slice(0, 10).map((l) => {
                  const tone = l.ok ? "ok" : "warn";
                  const dur = l.details?.duration_ms != null ? `${fmt(l.details.duration_ms)} ms` : "—";
                  const msg = l.ok ? "OK" : "FAIL";
                  const detail = l.ok
                    ? JSON.stringify(l.details?.rebuilt || l.details?.stage || "ok")
                    : String(l.details?.error || "error");

                  return (
                    <tr key={l.id}>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                        {new Date(l.started_at).toLocaleString("es-ES")}
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{l.job}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                        <Badge tone={tone as any}>{msg}</Badge>
                      </td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{dur}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#555" }}>{detail}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
