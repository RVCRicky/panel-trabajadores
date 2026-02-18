"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { QuickLink } from "@/components/ui/QuickLink";

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

type AttRow = {
  minutes: number;
  calls: number;
  codigo: "free" | "rueda" | "cliente" | "repite";
  captado: boolean;
  worker: { id: string; display_name: string; role: WorkerRole } | null;
};

function fmt(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES");
}

export default function AdminPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  // KPI / resumen
  const [onlineNow, setOnlineNow] = useState<number | null>(null);
  const [missingNow, setMissingNow] = useState<number | null>(null);
  const [pendingIncidents, setPendingIncidents] = useState<number | null>(null);

  // Sync CSV
  const [csvUrl, setCsvUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncDebug, setSyncDebug] = useState<string | null>(null);

  // Ranking
  const [loadingRank, setLoadingRank] = useState(false);
  const [rankMsg, setRankMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<AttRow[]>([]);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
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

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // ✅ KPIs (presencia + pendientes)
  async function loadKpis() {
    try {
      const token = await getToken();
      if (!token) return;

      // Presencia (incluye missingCount en tu endpoint)
      const pr = await fetch("/api/admin/presence/live?show=all", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pj = await pr.json().catch(() => null);

      if (pj?.ok) {
        const rows = Array.isArray(pj.rows) ? pj.rows : [];
        const online = rows.filter((r: any) => r.state && r.state !== "offline").length;
        setOnlineNow(online);
        setMissingNow(typeof pj.missingCount === "number" ? pj.missingCount : 0);
      } else {
        setOnlineNow(null);
        setMissingNow(null);
      }

      // Incidencias pendientes (si el endpoint existe)
      const ir = await fetch("/api/admin/incidents/pending", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ij = await ir.json().catch(() => null);
      if (ij?.ok) {
        const count =
          typeof ij.count === "number"
            ? ij.count
            : Array.isArray(ij.items)
            ? ij.items.length
            : Array.isArray(ij.rows)
            ? ij.rows.length
            : 0;
        setPendingIncidents(count);
      } else {
        // si no existe todavía o falla, no rompemos
        setPendingIncidents(null);
      }
    } catch {
      setOnlineNow(null);
      setMissingNow(null);
      setPendingIncidents(null);
    }
  }

  useEffect(() => {
    if (status !== "OK") return;
    loadKpis();
    const t = setInterval(loadKpis, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function loadRankings() {
    setRankMsg(null);
    setLoadingRank(true);
    try {
      const { data: att, error } = await supabase
        .from("attendance_rows")
        .select("minutes,calls,codigo,captado,worker:workers(id,display_name,role)")
        .order("id", { ascending: false })
        .limit(50000);

      if (error) {
        setRankMsg(`Error leyendo attendance_rows: ${error.message}`);
        return;
      }

      setRows((att as any) || []);
    } catch (e: any) {
      setRankMsg(e?.message || "Error inesperado");
    } finally {
      setLoadingRank(false);
    }
  }

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

      setSyncMsg(`✅ Sync OK. Insertadas: ${j.inserted}. Saltadas sin worker: ${j.skippedNoWorker}. Filas malas: ${j.skippedBad}. Total CSV: ${j.totalRows}`);

      await loadRankings();
      await loadKpis();
    } finally {
      setSyncing(false);
    }
  }

  const ranking = useMemo(() => {
    const m = new Map<
      string,
      { name: string; role: WorkerRole; minutes: number; captadas: number }
    >();

    for (const r of rows) {
      if (!r.worker) continue;
      const id = r.worker.id;
      if (!m.has(id)) {
        m.set(id, { name: r.worker.display_name, role: r.worker.role, minutes: 0, captadas: 0 });
      }
      const it = m.get(id)!;
      it.minutes += Number(r.minutes) || 0;
      if (r.captado) it.captadas += 1;
    }

    const arr = Array.from(m.values()).filter((x) => x.role === "tarotista");
    arr.sort((a, b) => b.minutes - a.minutes);
    return arr.slice(0, 10);
  }, [rows]);

  const toneMissing = missingNow && missingNow > 0 ? "warn" : "ok";
  const tonePending = pendingIncidents && pendingIncidents > 0 ? "warn" : "ok";
  const toneOnline = onlineNow && onlineNow > 0 ? "ok" : "neutral";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Header interno (tu layout ya pone el menú arriba) */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Dashboard Admin</h1>
        <span style={{ marginLeft: "auto", color: "#666" }}>
          Estado: <b style={{ color: "#111" }}>{status}</b> {status === "OK" ? <>· Admin: <b style={{ color: "#111" }}>{meName}</b></> : null}
        </span>
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

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Presencia online ahora</CardTitle>
          <CardValue>{onlineNow === null ? "—" : fmt(onlineNow)}</CardValue>
          <CardHint>
            <Badge tone={toneOnline as any}>{onlineNow && onlineNow > 0 ? "OK" : "Sin datos"}</Badge> · Se actualiza cada 10s
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Deberían estar y no están</CardTitle>
          <CardValue>{missingNow === null ? "—" : fmt(missingNow)}</CardValue>
          <CardHint>
            <Badge tone={toneMissing as any}>{missingNow && missingNow > 0 ? "Revisar" : "Todo bien"}</Badge> · Turnos actuales
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Incidencias pendientes</CardTitle>
          <CardValue>{pendingIncidents === null ? "—" : fmt(pendingIncidents)}</CardValue>
          <CardHint>
            <Badge tone={tonePending as any}>{pendingIncidents && pendingIncidents > 0 ? "Acción" : "OK"}</Badge> · Justificar / No justificar
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Acciones rápidas</CardTitle>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <a href="/admin/live" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none", fontWeight: 900 }}>
              Ver presencia →
            </a>
            <a href="/admin/incidents" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none", fontWeight: 900 }}>
              Ver incidencias →
            </a>
          </div>
          <CardHint>Todo en 1 click.</CardHint>
        </Card>
      </div>

      {/* Accesos a secciones */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <QuickLink href="/admin/live" title="Presencia" desc="Quién está online / pausa / baño y quién falta." />
        <QuickLink href="/admin/incidents" title="Incidencias" desc="Justificar / No justificar, historial y control." />
        <QuickLink href="/admin/workers" title="Trabajadores" desc="Altas, bajas, roles, activar/desactivar." />
        <QuickLink href="/admin/mappings" title="Mappings" desc="Enlaces de CSV/Drive con trabajadores." />
      </div>

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
              onClick={loadRankings}
              disabled={loadingRank || status !== "OK"}
              style={{
                padding: 12,
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: loadingRank ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              {loadingRank ? "Cargando..." : "Actualizar ranking"}
            </button>

            <button
              onClick={loadKpis}
              disabled={status !== "OK"}
              style={{
                padding: 12,
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: status !== "OK" ? "not-allowed" : "pointer",
                fontWeight: 900,
              }}
            >
              Refrescar KPIs
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

          {rankMsg ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
              {rankMsg}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Mini ranking */}
      <Card>
        <CardTitle>Top 10 tarotistas (minutos)</CardTitle>
        <CardHint>Para ver el ranking completo, entra en tu /panel.</CardHint>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 740 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>#</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tarotista</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Minutos</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Captadas</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 10, color: "#666" }}>
                    Aún no hay datos. Pulsa “Sync ahora”.
                  </td>
                </tr>
              ) : (
                ranking.map((r, idx) => (
                  <tr key={r.name}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{idx + 1}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>{fmt(r.minutes)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.captadas)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
