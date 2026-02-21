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

function fmtEur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
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

  finance?: {
    revenue_eur: number;
    expenses_total_eur: number;
    expenses_tarotistas_eur: number;
    expenses_centrales_eur: number;
    margin_eur: number;
    top3_expense_tarotistas: Array<{ worker_id: string; name: string; role: string; total_eur: number }>;
  };

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

  dailySeries: Array<{ date: string; minutes: number }>;
  dailyCaptadasSeries?: Array<{ date: string; captadas: number }>;
  captadasDailySeries?: Array<{ date: string; captadas: number }>;
  dailySeriesCaptadas?: Array<{ date: string; captadas: number }>;
};

type ChartMode = "minutes" | "captadas";

function clamp(n: number, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
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

      const cap = (j.dailyCaptadasSeries || j.captadasDailySeries || j.dailySeriesCaptadas || []) as any[];
      if ((!cap || cap.length === 0) && chartMode === "captadas") setChartMode("minutes");
    } catch (e: any) {
      setErr(e?.message || "Error overview");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status !== "OK") return;
    loadOverview(null);
    const t = setInterval(() => loadOverview(selectedMonth), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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

      setSyncMsg(`✅ Sync OK. Insertadas: ${j.inserted}. Saltadas sin worker: ${j.skippedNoWorker}. Filas malas: ${j.skippedBad}. Total CSV: ${j.totalRows}`);

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

  const presenceRatio = useMemo(() => {
    if (!presence || !presence.total) return 0;
    return Math.round(((presence.online || 0) / presence.total) * 100);
  }, [presence]);

  const revenue = overview?.finance?.revenue_eur ?? null;
  const expensesTotal = overview?.finance?.expenses_total_eur ?? null;
  const margin = overview?.finance?.margin_eur ?? null;

  const top3ExpenseTarot = overview?.finance?.top3_expense_tarotistas ?? [];

  const alerts = useMemo(() => {
    const a: Array<{ tone: "ok" | "warn" | "neutral"; text: string; href?: string }> = [];

    if ((pending ?? 0) > 0) a.push({ tone: "warn", text: `${fmt(pending)} incidencias pendientes por revisar.`, href: "/admin/incidents" });
    else a.push({ tone: "ok", text: "Incidencias: todo al día." });

    if (presence) {
      if ((presence.online || 0) === 0) a.push({ tone: "warn", text: "Presencia: nadie ONLINE ahora mismo.", href: "/admin/live" });
      else if (presenceRatio < 30) a.push({ tone: "warn", text: `Presencia baja: ${fmt(presence.online)} ONLINE (${presenceRatio}%).`, href: "/admin/live" });
      else a.push({ tone: "ok", text: `Presencia OK: ${fmt(presence.online)} ONLINE (${presenceRatio}%).`, href: "/admin/live" });
    }

    if (cronInfo.text === "FAIL") a.push({ tone: "warn", text: "CRON: último rebuild en FAIL (revisar logs)." });
    else if (cronInfo.text === "OK") a.push({ tone: "ok", text: "CRON: OK." });
    else a.push({ tone: "neutral", text: "CRON: sin logs." });

    if (revenue === 0 && (overview?.dailySeries?.length || 0) === 0) {
      a.push({ tone: "warn", text: "Facturación: 0€ y sin filas (¿no se ha sync el CSV del mes?)." });
    }

    return a.slice(0, 3);
  }, [pending, presence, presenceRatio, cronInfo.text, revenue, overview?.dailySeries?.length]);

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Dashboard Admin</h1>

        {/* Selector de mes */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#666", fontWeight: 900 }}>Mes:</span>
          <select
            value={selectedMonth || overview?.month_date || ""}
            onChange={(e) => setSelectedMonth(e.target.value || null)}
            style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", minWidth: 220, maxWidth: "100%" }}
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
          <span style={{ color: "#666" }}>
            <b>{monthLabel}</b>
          </span>
        </div>

        <span style={{ marginLeft: "auto", color: "#666" }}>
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
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <button
          onClick={logout}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 900 }}
        >
          Cerrar sesión
        </button>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10 }}>{err}</div>
      ) : null}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Facturación mes</CardTitle>
          <CardValue>{revenue == null ? "—" : fmtEur(revenue)}</CardValue>
          <CardHint>Ingresos reales del mes</CardHint>
        </Card>

        <Card>
          <CardTitle>Gastos mes</CardTitle>
          <CardValue>{expensesTotal == null ? "—" : fmtEur(expensesTotal)}</CardValue>
          <CardHint>Pagos totales del mes</CardHint>
        </Card>

        <Card>
          <CardTitle>Margen estimado</CardTitle>
          <CardValue>{margin == null ? "—" : fmtEur(margin)}</CardValue>
          <CardHint>Facturación − Gastos</CardHint>
        </Card>

        <Card>
          <CardTitle>Minutos del mes</CardTitle>
          <CardValue>{overview?.totals ? `${fmt(overview.totals.minutes)} min` : "—"}</CardValue>
          <CardHint>Producción acumulada del mes</CardHint>
        </Card>

        <Card>
          <CardTitle>Captadas del mes</CardTitle>
          <CardValue>{overview?.totals ? fmt(overview.totals.captadas) : "—"}</CardValue>
          <CardHint>Conversión / captación registrada</CardHint>
        </Card>

        <Card>
          <CardTitle>Presencia ahora</CardTitle>
          <CardValue>{presence ? `${fmt(presence.online)} ONLINE` : "—"}</CardValue>
          <CardHint>
            <Badge tone={toneOnline as any}>ONLINE</Badge> · Total: <b>{presence ? fmt(presence.total) : "—"}</b> · Ratio:{" "}
            <b>{presence ? `${presenceRatio}%` : "—"}</b>
          </CardHint>
        </Card>
      </div>

      {/* Accesos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <QuickLink href="/admin/live" title="Presencia" desc="Quién está online / pausa / baño y quién falta." />
        <QuickLink href="/admin/incidents" title="Incidencias" desc="Justificar / No justificar, historial y control." />
        <QuickLink href="/admin/workers" title="Trabajadores" desc="Altas, bajas, roles, activar/desactivar." />
        <QuickLink href="/admin/mappings" title="Mappings" desc="Enlaces de CSV/Drive con trabajadores." />
        <QuickLink href="/admin/invoices" title="Facturas" desc="Ver facturas, añadir extras y sanciones." />
      </div>

      {/* Gráfico */}
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
        </div>

        <div style={{ marginTop: 10 }}>
          <MiniBarChart data={chartMode === "minutes" ? dailyMinutesData : dailyCaptadasData} height={180} unit={chartUnit} />
        </div>
      </Card>

      {/* Sync CSV */}
      <Card>
        <CardTitle>Sincronizar Google Sheets (CSV)</CardTitle>

        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <input
            value={csvUrl}
            onChange={(e) => setCsvUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc", width: "100%", maxWidth: "100%" }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={runSync}
              disabled={syncing || status !== "OK" || !csvUrl.trim()}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 900 }}
            >
              {syncing ? "Sincronizando..." : "Sync ahora"}
            </button>

            <button
              onClick={() => loadOverview(selectedMonth)}
              disabled={loading || status !== "OK"}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #ddd", background: "#fff", fontWeight: 900 }}
            >
              {loading ? "Cargando..." : "Refrescar dashboard"}
            </button>
          </div>

          {syncMsg ? <div style={{ padding: 10, borderRadius: 10, background: "#f6f6f6", border: "1px solid #e5e5e5" }}>{syncMsg}</div> : null}

          {syncDebug ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#fff", border: "1px solid #e5e5e5" }}>
              <b>DEBUG:</b>
              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{syncDebug}</pre>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Top tables */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
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

              <div style={{ overflowX: "auto", marginTop: 10, width: "100%" }}>
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
                        <td colSpan={box.key === "minutes" ? 4 : 3} style={{ padding: 10, color: "#666" }}>
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

      {/* Cron logs */}
      <Card>
        <CardTitle>Últimas ejecuciones CRON</CardTitle>
        <CardHint>Si ves FAIL, revisa Vercel Functions Logs.</CardHint>

        <div style={{ overflowX: "auto", marginTop: 10, width: "100%" }}>
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
                  <td colSpan={5} style={{ padding: 10, color: "#666" }}>
                    Sin logs aún.
                  </td>
                </tr>
              ) : (
                (overview?.cronLogs || []).slice(0, 10).map((l) => {
                  const tone = l.ok ? "ok" : "warn";
                  const dur = l.details?.duration_ms != null ? `${fmt(l.details.duration_ms)} ms` : "—";
                  const msg = l.ok ? "OK" : "FAIL";
                  const detail = l.ok ? JSON.stringify(l.details?.rebuilt || l.details?.stage || "ok") : String(l.details?.error || "error");

                  return (
                    <tr key={l.id}>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{new Date(l.started_at).toLocaleString("es-ES")}</td>
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
