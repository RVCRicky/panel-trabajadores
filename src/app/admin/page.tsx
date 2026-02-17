"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

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

export default function AdminPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  const [csvUrl, setCsvUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncDebug, setSyncDebug] = useState<string | null>(null);

  const [loadingRank, setLoadingRank] = useState(false);
  const [rankMsg, setRankMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<AttRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session?.access_token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
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
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
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
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
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

      await loadRankings();
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
    <div style={{ padding: 18, maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>Admin</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <p style={{ margin: 0 }}>
          Estado: <b>{status}</b>
        </p>
        {status === "OK" ? (
          <p style={{ marginTop: 8, color: "#666" }}>
            Admin: <b>{meName}</b>
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a
          href="/admin/workers"
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
        >
          Gestionar trabajadores →
        </a>

        <a
          href="/admin/mappings"
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
        >
          Mappings →
        </a>

        {/* ✅ NUEVO: acceso directo a presencia en vivo */}
        <a
          href="/admin/presence"
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          Presencia en directo →
        </a>

        <button
          onClick={logout}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Cerrar sesión
        </button>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Sincronizar Google Sheets (CSV)</h2>

        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={csvUrl}
            onChange={(e) => setCsvUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />

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
              fontWeight: 700,
              width: 220,
            }}
          >
            {syncing ? "Sincronizando..." : "Sync ahora"}
          </button>

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
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Ranking global (Top 20 tarotistas por minutos)</h2>

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
            fontWeight: 700,
            marginTop: 8,
          }}
        >
          {loadingRank ? "Cargando..." : "Actualizar ranking"}
        </button>

        {rankMsg ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
            {rankMsg}
          </div>
        ) : null}

        <div style={{ overflowX: "auto", marginTop: 10 }}>
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
                  <tr key={r.name}>
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
      </div>
    </div>
  );
}
