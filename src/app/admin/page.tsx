"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, background: "#fff" }}>
      <div style={{ fontWeight: 950, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid #eee",
        background: "#fafafa",
        fontWeight: 900,
        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}

export default function AdminPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  // CSV Sync
  const [csvUrl, setCsvUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncDebug, setSyncDebug] = useState<string | null>(null);

  // Ranking
  const [loadingRank, setLoadingRank] = useState(false);
  const [rankMsg, setRankMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<AttRow[]>([]);

  // Resumen / Alertas
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [missingCount, setMissingCount] = useState<number>(0);
  const [missingNames, setMissingNames] = useState<string[]>([]);
  const [pendingIncidentsCount, setPendingIncidentsCount] = useState<number>(0);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = (await res.json()) as MeResp;

      if (!json.ok) {
        setStatus(`Error /api/me: ${json.error}`);
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

      // al entrar, cargamos resumen (pendientes)
      await loadSummary();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function loadSummary() {
    setSummaryLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      // 1) Turnos pendientes (shift_missing_now viene dentro del live)
      // si tu endpoint usa filtro por defecto (no offline), NO afecta a missing: missing viene aparte.
      const pres = await fetch("/api/admin/presence/live", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pj = await pres.json().catch(() => null);

      if (pj?.ok) {
        const mc = Number(pj.missingCount) || 0;
        setMissingCount(mc);

        // intentamos sacar nombres si vienen en pj.missing
        const names =
          (pj.missing || [])
            .map((x: any) => x?.name || x?.display_name || x?.worker_name || "")
            .filter(Boolean) || [];
        setMissingNames(names.slice(0, 8));
      }

      // 2) Incidencias pendientes (si existe endpoint)
      const inc = await fetch("/api/admin/incidents/pending", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ij = await inc.json().catch(() => null);

      if (ij?.ok) {
        const c =
          Number(ij.pendingCount) ||
          Number(ij.count) ||
          (Array.isArray(ij.rows) ? ij.rows.length : 0) ||
          (Array.isArray(ij.pending) ? ij.pending.length : 0) ||
          0;
        setPendingIncidentsCount(c);
      }
    } finally {
      setSummaryLoading(false);
    }
  }

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

      setSyncMsg(
        `✅ Sync OK. Insertadas: ${j.inserted}. Saltadas sin worker: ${j.skippedNoWorker}. Filas malas: ${j.skippedBad}. Total CSV: ${j.totalRows}`
      );

      // refrescamos ranking + resumen
      await loadRankings();
      await loadSummary();
    } finally {
      setSyncing(false);
    }
  }

  const ranking = useMemo(() => {
    const m = new Map<
      string,
      {
        name: string;
        role: WorkerRole;
        minutes: number;
        calls: number;
        captadas: number;
        free: number;
        rueda: number;
        cliente: number;
        repite: number;
      }
    >();

    for (const r of rows) {
      if (!r.worker) continue;
      const id = r.worker.id;
      if (!m.has(id)) {
        m.set(id, {
          name: r.worker.display_name,
          role: r.worker.role,
          minutes: 0,
          calls: 0,
          captadas: 0,
          free: 0,
          rueda: 0,
          cliente: 0,
          repite: 0,
        });
      }
      const it = m.get(id)!;
      it.minutes += Number(r.minutes) || 0;
      it.calls += Number(r.calls) || 0;
      if (r.captado) it.captadas += 1;

      if (r.codigo === "free") it.free += Number(r.minutes) || 0;
      if (r.codigo === "rueda") it.rueda += Number(r.minutes) || 0;
      if (r.codigo === "cliente") it.cliente += Number(r.minutes) || 0;
      if (r.codigo === "repite") it.repite += Number(r.minutes) || 0;
    }

    const arr = Array.from(m.values());
    const tarotistas = arr.filter((x) => x.role === "tarotista");
    tarotistas.sort((a, b) => b.minutes - a.minutes);
    return tarotistas.slice(0, 20);
  }, [rows]);

  return (
    <div style={{ padding: 2 }}>
      {/* Header del contenido */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Dashboard Admin</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={loadSummary}
            disabled={summaryLoading || status !== "OK"}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: summaryLoading ? "#eee" : "#fff",
              fontWeight: 900,
              cursor: summaryLoading ? "not-allowed" : "pointer",
            }}
          >
            {summaryLoading ? "Actualizando..." : "Actualizar resumen"}
          </button>

          <button
            onClick={logout}
            style={{
              padding: "10px 12px",
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
      </div>

      {/* Cards resumen */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Card title="Estado del sistema">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Pill>
              Estado: <span style={{ fontWeight: 950 }}>{status}</span>
            </Pill>
            {status === "OK" ? (
              <span style={{ color: "#666" }}>
                Admin: <b style={{ color: "#111" }}>{meName}</b>
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
            Consejo: usa “Actualizar resumen” para ver pendientes y incidencias al instante.
          </div>
        </Card>

        <Card title="Turnos pendientes (deberían estar y no están)">
          <div style={{ fontSize: 34, fontWeight: 1000, lineHeight: 1 }}>{missingCount}</div>
          {missingCount > 0 ? (
            <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
              {missingNames.length ? (
                <>
                  Ej.: <b style={{ color: "#111" }}>{missingNames.join(", ")}</b>
                  {missingCount > missingNames.length ? "…" : null}
                </>
              ) : (
                <>Hay personas pendientes ahora.</>
              )}
            </div>
          ) : (
            <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>Todo correcto ahora mismo.</div>
          )}
          <div style={{ marginTop: 10 }}>
            <a
              href="/admin/live"
              style={{
                display: "inline-block",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #111",
                textDecoration: "none",
                fontWeight: 950,
                color: "#111",
              }}
            >
              Ver presencia →
            </a>
          </div>
        </Card>

        <Card title="Incidencias pendientes">
          <div style={{ fontSize: 34, fontWeight: 1000, lineHeight: 1 }}>{pendingIncidentsCount}</div>
          <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
            Faltas/retardos por revisar (justificada / no justificada).
          </div>
          <div style={{ marginTop: 10 }}>
            <a
              href="/admin/incidents"
              style={{
                display: "inline-block",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #111",
                textDecoration: "none",
                fontWeight: 950,
                color: "#111",
              }}
            >
              Gestionar incidencias →
            </a>
          </div>
        </Card>
      </div>

      {/* Accesos rápidos */}
      <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, marginBottom: 12, background: "#fff" }}>
        <div style={{ fontWeight: 950, marginBottom: 10 }}>Accesos rápidos</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/admin/live" style={quickLink(true)}>
            Presencia en directo →
          </a>
          <a href="/admin/incidents" style={quickLink(false)}>
            Incidencias →
          </a>
          <a href="/admin/workers" style={quickLink(false)}>
            Trabajadores →
          </a>
          <a href="/admin/mappings" style={quickLink(false)}>
            Mappings →
          </a>
        </div>
      </div>

      {/* Sync CSV */}
      <div style={{ marginBottom: 12 }}>
        <Card title="Sincronizar Google Sheets (CSV)">
          <div style={{ display: "grid", gap: 10 }}>
            <input
              value={csvUrl}
              onChange={(e) => setCsvUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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

              <span style={{ color: "#666", fontSize: 12 }}>
                Al terminar, refresca ranking y pendientes automáticamente.
              </span>
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
      </div>

      {/* Ranking */}
      <Card title="Ranking global (Top 20 tarotistas por minutos)">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <button
            onClick={loadRankings}
            disabled={loadingRank || status !== "OK"}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #111",
              background: loadingRank ? "#eee" : "#fff",
              color: "#111",
              cursor: loadingRank ? "not-allowed" : "pointer",
              fontWeight: 900,
            }}
          >
            {loadingRank ? "Cargando..." : "Actualizar ranking"}
          </button>

          <span style={{ color: "#666", fontSize: 12 }}>
            Tip: para ver datos nuevos, primero haz “Sync ahora”.
          </span>
        </div>

        {rankMsg ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
            {rankMsg}
          </div>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
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
                  <tr key={`${r.name}-${idx}`}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{idx + 1}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{r.minutes}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{r.captadas}</td>
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

function quickLink(primary: boolean) {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: primary ? "1px solid #111" : "1px solid #ddd",
    textDecoration: "none",
    fontWeight: 950,
    background: primary ? "#111" : "#fff",
    color: primary ? "#fff" : "#111",
  } as React.CSSProperties;
}
