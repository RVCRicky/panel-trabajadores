"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { QuickLink } from "@/components/ui/QuickLink";
import { MiniBarChart } from "@/components/charts/MiniBarChart";

import styles from "./page.module.css";

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

  // ✅ FINANZAS
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
    <div className={styles.wrap}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.h1}>Dashboard Admin</h1>

        {/* Selector de mes */}
        <div className={styles.monthRow}>
          <span className={styles.monthLabel}>Mes:</span>
          <select
            value={selectedMonth || overview?.month_date || ""}
            onChange={(e) => setSelectedMonth(e.target.value || null)}
            className={styles.select}
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
          <span className={styles.monthHuman}>
            <b>{monthLabel}</b>
          </span>
        </div>

        <div className={styles.headerRight}>
          <span className={styles.statusText}>
            Estado: <b className={styles.statusStrong}>{status}</b>
            {status === "OK" ? (
              <>
                {" "}
                · Admin: <b className={styles.statusStrong}>{meName}</b>
              </>
            ) : null}
          </span>

          <div className={styles.headerButtons}>
            <button onClick={() => loadOverview(selectedMonth)} disabled={loading || status !== "OK"} className={styles.btn}>
              {loading ? "Actualizando..." : "Actualizar"}
            </button>

            <button onClick={logout} className={styles.btnPrimary}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>

      {err ? <div className={styles.errorBox}>{err}</div> : null}

      {/* ===== CENTRO DE CONTROL ===== */}
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <div className={styles.sectionTitle}>Centro de control</div>
            <div className={styles.sectionDesc}>En 10 segundos sabes si el mes va bien, quién lidera y dónde hay que apretar.</div>
          </div>

          <div className={styles.chips}>
            <span className={styles.chip}>📌 Objetivo: foco en repetición</span>
            <span className={styles.chip}>🧾 Cierre de mes: preparado</span>
          </div>
        </div>

        {/* KPIs */}
        <div className={styles.kpiGrid}>
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
            <CardHint>Producción acumulada</CardHint>
          </Card>

          <Card>
            <CardTitle>Captadas del mes</CardTitle>
            <CardValue>{overview?.totals ? fmt(overview.totals.captadas) : "—"}</CardValue>
            <CardHint>Conversión / captación</CardHint>
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

        {/* Top 3 + Alertas */}
        <div className={styles.twoCol}>
          <Card>
            <div className={styles.cardHeadRow}>
              <div>
                <CardTitle>Top 3 gasto tarotistas (€)</CardTitle>
                <CardHint>Gasto (no facturación)</CardHint>
              </div>
              <span className={styles.chip}>🧾 Pagos</span>
            </div>

            <div className={styles.top3List}>
              {top3ExpenseTarot.length === 0 ? (
                <div className={styles.muted}>Sin datos de gasto tarotistas para este mes.</div>
              ) : (
                top3ExpenseTarot.map((r, idx) => {
                  const max = Math.max(1, ...top3ExpenseTarot.map((x) => Number(x.total_eur) || 0));
                  const w = Math.round(((Number(r.total_eur) || 0) / max) * 100);

                  return (
                    <div key={r.worker_id} className={styles.top3Item}>
                      <div className={styles.top3Row}>
                        <div className={styles.top3Left}>
                          <div className={styles.rank}>{idx + 1}</div>
                          <div className={styles.top3NameWrap}>
                            <div className={styles.top3Name}>{r.name}</div>
                            <div className={styles.top3Role}>Tarotista</div>
                          </div>
                        </div>

                        <div className={styles.top3Right}>
                          <div className={styles.top3Eur}>{fmtEur(r.total_eur)}</div>
                          <div className={styles.top3Small}>Total</div>
                        </div>
                      </div>

                      <div className={styles.barOuter}>
                        <div className={styles.barInner} style={{ width: `${clamp(w)}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card>
            <div className={styles.cardHeadRow}>
              <div>
                <CardTitle>Alertas</CardTitle>
                <CardHint>Lo que necesita acción hoy</CardHint>
              </div>
              <span className={styles.chip}>⚠️ Prioridades</span>
            </div>

            <div className={styles.alertsList}>
              {alerts.length === 0 ? (
                <div className={styles.muted}>Sin alertas.</div>
              ) : (
                alerts.map((a, i) => (
                  <div key={i} className={`${styles.alertItem} ${a.tone === "warn" ? styles.warn : a.tone === "ok" ? styles.ok : styles.neutral}`}>
                    <div className={styles.alertText}>{a.text}</div>
                    {a.href ? (
                      <button onClick={() => router.push(a.href!)} className={styles.btnPrimary}>
                        Abrir
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className={styles.tip}>Consejo: cuando esto baja, sube el rendimiento sin “perseguir” a nadie.</div>
          </Card>
        </div>
      </div>

      {/* Accesos */}
      <div className={styles.linksGrid}>
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

        <div className={styles.toggleRow}>
          <button
            onClick={() => setChartMode("minutes")}
            className={`${styles.toggleBtn} ${chartMode === "minutes" ? styles.toggleActive : ""}`}
          >
            Minutos
          </button>

          <button
            onClick={() => setChartMode("captadas")}
            disabled={dailyCaptadasData.length === 0}
            className={`${styles.toggleBtn} ${chartMode === "captadas" ? styles.toggleActive : ""}`}
          >
            Captadas
          </button>

          <div className={styles.toggleHint}>
            Mostrando: <b>{chartMode === "minutes" ? "Minutos/día" : "Captadas/día"}</b>
          </div>
        </div>

        <div className={styles.chartWrap}>
          <MiniBarChart data={chartData} height={180} unit={chartUnit} />
        </div>
      </Card>

      {/* Sync CSV */}
      <Card>
        <CardTitle>Sincronizar Google Sheets (CSV)</CardTitle>

        <div className={styles.syncBox}>
          <input
            value={csvUrl}
            onChange={(e) => setCsvUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv"
            className={styles.input}
          />

          <div className={styles.syncBtns}>
            <button onClick={runSync} disabled={syncing || status !== "OK" || !csvUrl.trim()} className={styles.btnPrimary}>
              {syncing ? "Sincronizando..." : "Sync ahora"}
            </button>

            <button onClick={() => loadOverview(selectedMonth)} disabled={loading || status !== "OK"} className={styles.btn}>
              {loading ? "Cargando..." : "Refrescar dashboard"}
            </button>
          </div>

          {syncMsg ? <div className={styles.noteBox}>{syncMsg}</div> : null}

          {syncDebug ? (
            <div className={styles.debugBox}>
              <b>DEBUG:</b>
              <pre className={styles.pre}>{syncDebug}</pre>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Top tables */}
      <div className={styles.twoCol}>
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

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>#</th>
                      <th className={styles.th}>Tarotista</th>
                      <th className={`${styles.th} ${styles.thRight}`}>{label}</th>
                      {box.key === "minutes" ? <th className={`${styles.th} ${styles.thRight} ${styles.hideOnMobile}`}>Cap</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 ? (
                      <tr>
                        <td colSpan={box.key === "minutes" ? 4 : 3} className={styles.tdMuted}>
                          Sin datos.
                        </td>
                      </tr>
                    ) : (
                      list.map((r: any, idx: number) => (
                        <tr key={r.worker_id}>
                          <td className={styles.td}>{idx + 1}</td>
                          <td className={`${styles.td} ${styles.tdEllipsis}`}>{r.name}</td>
                          <td className={`${styles.td} ${styles.tdRight} ${styles.tdStrong}`}>
                            {box.key === "minutes"
                              ? fmt(r.minutes)
                              : box.key === "captadas"
                              ? fmt(r.captadas)
                              : `${fmt(box.key === "cliente_pct" ? r.cliente_pct : r.repite_pct)} %`}
                          </td>
                          {box.key === "minutes" ? (
                            <td className={`${styles.td} ${styles.tdRight} ${styles.hideOnMobile}`}>{fmt(r.captadas)}</td>
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

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Fecha</th>
                <th className={styles.th}>Job</th>
                <th className={styles.th}>Estado</th>
                <th className={`${styles.th} ${styles.thRight} ${styles.hideOnMobile}`}>Duración</th>
                <th className={`${styles.th} ${styles.hideOnMobile}`}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.cronLogs || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.tdMuted}>
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
                      <td className={`${styles.td} ${styles.tdEllipsis}`}>{new Date(l.started_at).toLocaleString("es-ES")}</td>
                      <td className={`${styles.td} ${styles.tdEllipsis}`}>{l.job}</td>
                      <td className={styles.td}>
                        <Badge tone={tone as any}>{msg}</Badge>
                      </td>
                      <td className={`${styles.td} ${styles.tdRight} ${styles.hideOnMobile}`}>{dur}</td>
                      <td className={`${styles.td} ${styles.tdEllipsis} ${styles.hideOnMobile}`}>{detail}</td>
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
