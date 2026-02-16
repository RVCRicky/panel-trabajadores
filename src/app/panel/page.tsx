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
        <h2>Mis estadísticas</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Card title="Mis minutos" value={fmt(s?.minutes || 0)} />
          <Card title="Mis captadas" value={fmt(s?.captadas || 0)} />
          <Card
            title="Desglose"
            value={`${fmt(s?.cliente || 0)} cliente`}
            sub={`free ${fmt(s?.free || 0)} · rueda ${fmt(s?.rueda || 0)} · repite ${fmt(
              s?.repite || 0
            )}`}
          />
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2>Ranking global (tarotistas)</h2>

        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Tarotista</th>
              <th>Minutos</th>
              <th>Captadas</th>
              <th>Free</th>
              <th>Rueda</th>
              <th>Cliente</th>
              <th>Repite</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isMe = me?.display_name === r.name;

              return (
                <tr
                  key={r.worker_id}
                  style={{
                    background: isMe ? "#e8f4ff" : "transparent",
                    fontWeight: isMe ? 700 : 400,
                  }}
                >
                  <td>{idx + 1}</td>
                  <td>{r.name}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.minutes)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.captadas)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.free)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.rueda)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.cliente)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.repite)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={logout}>Cerrar sesión</button>
      </div>
    </div>
  );
}
