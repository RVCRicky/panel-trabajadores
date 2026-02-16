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

type StatsGlobalResp =
  | { ok: true; tarotistasTop: StatRow[]; centralesTop: StatRow[]; totalRows: number }
  | { ok: false; error: string };

type MyStatsResp =
  | {
      ok: true;
      worker: null | { id: string; role: WorkerRole; display_name: string; is_active: boolean };
      stats: null | {
        minutes: number;
        calls: number;
        captadas: number;
        free: number;
        rueda: number;
        cliente: number;
        repite: number;
      };
    }
  | { ok: false; error: string };

function fmt(n: number) {
  return (Number(n) || 0).toLocaleString("es-ES");
}

function medalForRank(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function Card(props: { title: string; value: string; sub?: string }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 14, padding: 14, minWidth: 220, flex: "1 1 220px" }}>
      <div style={{ color: "#666", fontSize: 13 }}>{props.title}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{props.value}</div>
      {props.sub ? <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>{props.sub}</div> : null}
    </div>
  );
}

export default function PanelPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [me, setMe] = useState<MeOk["worker"]>(null);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<StatRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);

  const [myStats, setMyStats] = useState<any>(null);
  const [myStatsMsg, setMyStatsMsg] = useState<string | null>(null);

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

      setMe(json.worker);
      setStatus("OK");

      await loadEverything();
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function loadMyStats() {
    setMyStatsMsg(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const r = await fetch("/api/stats/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const j = (await r.json()) as MyStatsResp;

    if (!j.ok) {
      setMyStatsMsg((j as any).error);
      return;
    }

    setMyStats(j);
  }

  async function loadGlobalStats() {
    setLoading(true);
    setMsg(null);

    const r = await fetch("/api/stats/global");
    const j = (await r.json()) as StatsGlobalResp;

    if (j.ok) {
      setRows(j.tarotistasTop || []);
      setTotalRows(j.totalRows || 0);
    } else {
      setMsg(j.error);
    }

    setLoading(false);
  }

  async function loadEverything() {
    await Promise.all([loadMyStats(), loadGlobalStats()]);
  }

  const s = myStats?.stats || null;

  const myRank = useMemo(() => {
    if (!me?.display_name) return null;
    const idx = rows.findIndex((r) => r.name === me.display_name);
    if (idx === -1) return null;
    return idx + 1;
  }, [me?.display_name, rows]);

  const myRankMedal = myRank ? medalForRank(myRank) : "";

  return (
    <div style={{ padding: 18, maxWidth: 1040 }}>
      <h1 style={{ marginTop: 0 }}>Panel</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        Estado: <b>{status}</b>
        {me && (
          <div style={{ marginTop: 8, color: "#666" }}>
            Usuario: <b>{me.display_name}</b> · Rol: <b>{me.role}</b>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ marginBottom: 10 }}>Mis estadísticas</h2>

        {myStatsMsg ? (
          <div style={{ padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc", marginBottom: 10 }}>
            {myStatsMsg}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Card title="Mis minutos" value={fmt(s?.minutes || 0)} />
          <Card title="Mis captadas" value={fmt(s?.captadas || 0)} sub="CAPTADO=true" />
          <Card
            title="Mi posición en ranking"
            value={myRank ? `${myRankMedal} #${myRank}` : "—"}
            sub={myRank ? "Según minutos (global)" : "Aún no estás en el top (o no hay datos)."}
          />
          <Card
            title="Desglose"
            value={`${fmt(s?.cliente || 0)} cliente`}
            sub={`free ${fmt(s?.free || 0)} · rueda ${fmt(s?.rueda || 0)} · repite ${fmt(s?.repite || 0)}`}
          />
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2 style={{ marginBottom: 8 }}>Ranking global (tarotistas)</h2>
        <div style={{ color: "#666", fontSize: 13 }}>
          Filas importadas: <b>{fmt(totalRows)}</b>
        </div>

        {msg ? (
          <div style={{ padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc", marginTop: 10 }}>
            {msg}
          </div>
        ) : null}

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={loadEverything}
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
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Cerrar sesión
          </button>

          {me?.role === "admin" ? (
            <a
              href="/admin"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
            >
              Ir a Admin →
            </a>
          ) : null}
        </div>

        <div style={{ overflowX: "auto", marginTop: 12 }}>
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
              {rows.map((r, idx) => {
                const rank = idx + 1;
                const isMe = me?.display_name === r.name;

                return (
                  <tr
                    key={r.worker_id}
                    style={{
                      background: isMe ? "#e8f4ff" : "transparent",
                      fontWeight: isMe ? 800 : 400,
                    }}
                  >
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      {medalForRank(rank)} {rank}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.minutes)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.captadas)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.free)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.rueda)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.cliente)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(r.repite)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
