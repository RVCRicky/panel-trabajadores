"use client";

import { useEffect, useState } from "react";
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

type StatRow = {
  worker_id: string;
  name: string;
  role: string;
  minutes: number;
  calls: number;
  captadas: number;
  free: number;
  rueda: number;
  cliente: number;
  repite: number;
};

type StatsResp =
  | { ok: true; tarotistasTop: StatRow[]; centralesTop: StatRow[]; totalRows: number }
  | { ok: false; error: string };

function fmt(n: number) {
  return (Number(n) || 0).toLocaleString("es-ES");
}

export default function PanelPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [me, setMe] = useState<MeOk["worker"]>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<StatRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);

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
        setStatus("No tienes perfil en workers. (Admin debe crear tu ficha)");
        return;
      }

      if (!json.worker.is_active) {
        setStatus("Usuario desactivado.");
        return;
      }

      setMe(json.worker);
      setStatus("OK");

      // cargar ranking al entrar
      await loadStats();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function loadStats() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch("/api/stats/global");
      const j = (await r.json()) as StatsResp;

      if (!j.ok) {
        setMsg(`Error stats: ${j.error}`);
        return;
      }

      setRows(j.tarotistasTop || []);
      setTotalRows(j.totalRows || 0);
    } catch (e: any) {
      setMsg(e?.message || "Error cargando stats");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 18, maxWidth: 1040 }}>
      <h1 style={{ marginTop: 0 }}>Panel</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        Estado: <b>{status}</b>
        {me ? (
          <div style={{ marginTop: 8, color: "#666" }}>
            Usuario: <b>{me.display_name}</b> · Rol: <b>{me.role}</b>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        {me?.role === "admin" ? (
          <a
            href="/admin"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
          >
            Ir a Admin →
          </a>
        ) : null}

        <button
          onClick={loadStats}
          disabled={loading || status !== "OK"}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: loading ? "#eee" : "#fff",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 700,
          }}
        >
          {loading ? "Actualizando..." : "Actualizar ranking"}
        </button>

        <button
          onClick={logout}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Cerrar sesión
        </button>
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Ranking global (tarotistas)</h2>
        <p style={{ marginTop: 6, color: "#666" }}>
          Filas importadas: <b>{fmt(totalRows)}</b>
        </p>

        {msg ? (
          <div style={{ padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
            {msg}
          </div>
        ) : null}

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>#</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tarotista</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Minutos</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Captadas</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>free</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>rueda</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>cliente</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>repite</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 10, color: "#666" }}>
                    No hay datos aún.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={r.worker_id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{idx + 1}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.minutes)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.captadas)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.free)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.rueda)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.cliente)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.repite)}</td>
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
