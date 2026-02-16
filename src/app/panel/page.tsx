"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type WorkerRole = "admin" | "central" | "tarotista";
type RankingType = "minutes" | "repite_pct" | "cliente_pct" | "captadas";

function fmt(n: number) {
  return (Number(n) || 0).toLocaleString("es-ES");
}

function medal(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

export default function PanelPage() {
  const router = useRouter();

  const [me, setMe] = useState<any>(null);
  const [rankingType, setRankingType] = useState<RankingType>("minutes");

  const [rankings, setRankings] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [myStats, setMyStats] = useState<any>(null);

  const [err, setErr] = useState<string | null>(null);

  async function getTokenOrRedirect(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || null;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  useEffect(() => {
    (async () => {
      const token = await getTokenOrRedirect();
      if (!token) return;

      const resMe = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const jMe = await resMe.json();
      setMe(jMe.worker);

      await loadAll(token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadAll(existingToken?: string) {
    setErr(null);

    const token = existingToken || (await getTokenOrRedirect());
    if (!token) return;

    // 1) rankings globales
    const res = await fetch("/api/stats/global");
    const j = await res.json();

    if (j.ok) {
      setRankings(j.tarotistasRankings);
      setRows(j.tarotistasRankings[rankingType] || []);
    } else {
      setErr(j.error || "Error cargando rankings");
    }

    // 2) mis stats
    const resStats = await fetch("/api/stats/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const jStats = await resStats.json();

    if (jStats.ok) {
      setMyStats(jStats.stats);
    } else {
      setErr(jStats.error || "Error cargando mis stats");
    }
  }

  useEffect(() => {
    if (rankings) setRows(rankings[rankingType] || []);
  }, [rankingType, rankings]);

  const myRank = useMemo(() => {
    if (!me) return null;
    const idx = rows.findIndex((r) => r.name === me.display_name);
    if (idx === -1) return null;
    return idx + 1;
  }, [rows, me]);

  function valueForRow(r: any) {
    if (rankingType === "minutes") return fmt(r.minutes);
    if (rankingType === "captadas") return fmt(r.captadas);
    if (rankingType === "repite_pct") return `${r.repite_pct} %`;
    if (rankingType === "cliente_pct") return `${r.cliente_pct} %`;
    return "";
  }

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1>Panel</h1>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10 }}>
          {err}
        </div>
      ) : null}

      {myStats ? (
        <div style={{ display: "flex", gap: 15, marginBottom: 20, flexWrap: "wrap" }}>
          <div>
            Mis minutos: <b>{fmt(myStats.minutes)}</b>
          </div>
          <div>
            Mis captadas: <b>{fmt(myStats.captadas)}</b>
          </div>
          <div>
            Mi posición: <b>{myRank ? `${medal(myRank)} #${myRank}` : "-"}</b>
          </div>
        </div>
      ) : null}

      <div style={{ marginBottom: 15 }}>
        <select value={rankingType} onChange={(e) => setRankingType(e.target.value as RankingType)} style={{ padding: 8 }}>
          <option value="minutes">Ranking por Minutos</option>
          <option value="repite_pct">Ranking por % Repite</option>
          <option value="cliente_pct">Ranking por % Cliente</option>
          <option value="captadas">Ranking por Captadas</option>
        </select>

        <button onClick={() => loadAll()} style={{ marginLeft: 10, padding: 8 }}>
          Actualizar
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>#</th>
            <th>Tarotista</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((r: any, idx: number) => {
            const isMe = me?.display_name === r.name;
            const rank = idx + 1;

            return (
              <tr
                key={r.worker_id}
                style={{
                  background: isMe ? "#e8f4ff" : "transparent",
                  fontWeight: isMe ? 700 : 400,
                }}
              >
                <td>
                  {medal(rank)} {rank}
                </td>
                <td>{r.name}</td>
                <td>{valueForRow(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
