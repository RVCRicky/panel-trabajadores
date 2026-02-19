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
  // isoMonthDate: "YYYY-MM-01"
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

  totals: {
    minutes: number;
    captadas: number;
    tarotistas: number;
  };

  top: {
    minutes: Array<{
      worker_id: string;
      name: string;
      minutes: number;
      captadas: number;
      cliente_pct: number;
      repite_pct: number;
    }>;
    captadas: Array<{
      worker_id: string;
      name: string;
      minutes: number;
      captadas: number;
      cliente_pct: number;
      repite_pct: number;
    }>;
    cliente_pct: Array<{
      worker_id: string;
      name: string;
      minutes: number;
      captadas: number;
      cliente_pct: number;
      repite_pct: number;
    }>;
    repite_pct: Array<{
      worker_id: string;
      name: string;
      minutes: number;
      captadas: number;
      cliente_pct: number;
      repite_pct: number;
    }>;
  };

  presence: {
    online: number;
    pause: number;
    bathroom: number;
    offline: number;
    total: number;
  };

  incidents: {
    pending: number;
  };

  cronLogs: Array<{
    id: number;
    job: string;
    ok: boolean;
    details: any;
    started_at: string;
    finished_at: string | null;
  }>;

  dailySeries: Array<{ date: string; minutes: number }>;
};

export default function AdminPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [overview, setOverview] = useState<OverviewResp | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

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
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json().catch(() => null)) as MeResp | null;

      if (!json?.ok) {
        setStatus(`Error /api/me: ${(json as any)?.error || "UNKNOWN"}`);
        return;
      }

      if (!json.worker) {
        setStatus("No tienes perfil en workers.");
        return;
      }

      if (!json.worker.is_active) {
        setStatus("Usuario desactivado.");
        return;
      }

      if (json.worker.role !== "admin") {
        router.replace("/panel");
        return;
      }

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

      // sincronizar selector con backend
      if (j.month_date && j.month_date !== selectedMonth) setSelectedMonth(j.month_date);
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
      if (!token) {
        router.replace("/login");
        return;
      }

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

  const dailyData = useMemo(() => {
    return (overview?.dailySeries || []).map((x) => ({
      date: x.date,
      value: Number(x.minutes) || 0,
    }));
  }, [overview?.dailySeries]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Dashboard Admin</h1>

        {/* Selector de mes */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#666", fontWeight: 900 }}>Mes:</span>
          <select
            value={selectedMonth || overview?.month_date || ""}
            onChange={(e) => setSelectedMonth(e.target.value || null)}
            style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", minWidth: 220 }}
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
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            fontWeight: 900,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <button
          onClick={logout}
          style={{
            padding: 10,
            borderRadius: 10,
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

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10 }}>{err}</div>
      ) : null}

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Totales mes (tarotistas)</CardTitle>
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
            <b>{presence ? fmt(presence.bathroom) : "—"}</b>
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
          <CardTitle>Cron (rebuild mensual)</CardTitle>
          <CardValue>
            <Badge tone={cronInfo.tone as any}>{cronInfo.text}</Badge>
          </CardValue>
          <CardHint>
            Duración: <b>{cronInfo.dur}</b> · Último: <b>{cronInfo.when}</b>
          </CardHint>
        </Card>
      </div>

      {/* Accesos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <QuickLink href="/admin/live" title="Presencia" desc="Quién está online / pausa / baño y quién falta." />
        <QuickLink href="/admin/incidents" title="Incidencias" desc="Justificar / No justificar, historial y control." />
        <QuickLink href="/admin/workers" title="Trabajadores" desc="Altas, bajas, roles, activar/desactivar." />
        <QuickLink href="/admin/mappings" title="Mappings" desc="Enlaces de CSV/Drive con trabajadores." />
      </div>

      {/* Gráfico simple */}
      <Card>
        <CardTitle>Minutos por día</CardTitle>
        <CardHint>Mes seleccionado · Gráfico simple (sin librerías).</CardHint>

        <div style={{ marginTop: 10 }}>
          <MiniBarChart data={dailyData} height={170} />
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
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={runSync}
              disabled={syncing || status !== "OK" || !csvUrl.trim()}
              style={{
                padding: 12,
                borderRadius: 10,
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
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {loading ? "Cargando..." : "Refrescar dashboard"}
            </button>
          </div>

          {syncMsg ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#f6f6f6", border: "1px solid #e5e5e5" }}>
              {syncMsg}
            </div>
          ) : null}

          {syncDebug ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#fff", border: "1px solid #e5e5e5" }}>
              <b>DEBUG:</b>
              <pre style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{syncDebug}</pre>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Top tables */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
        {[
          { key: "minutes", title: "Top 10 (Minutos)" },
          { key: "captadas", title: "Top 10 (Captadas)" },
          { key: "cliente_pct", title: "Top 10 (Cliente %)" },
          { key: "repite_pct", title: "Top 10 (Repite %)" },
        ].map((box) => {
          const list: any[] = (overview?.top as any)?.[box.key] || [];
          const label =
            box.key === "minutes" ? "Min" : box.key === "captadas" ? "Cap" : "%";

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
                  <td colSpan={5} style={{ padding: 10, color: "#666" }}>
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
