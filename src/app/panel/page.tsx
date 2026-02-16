"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type RankingType = "minutes" | "repite_pct" | "cliente_pct" | "captadas";
type WorkerRole = "admin" | "central" | "tarotista";

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

  const [rankingType, setRankingType] = useState<RankingType>("minutes");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [dash, setDash] = useState<any>(null);

  async function getTokenOrRedirect(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || null;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function loadDashboard() {
    setErr(null);
    setLoading(true);
    try {
      const token = await getTokenOrRedirect();
      if (!token) return;

      const r = await fetch(`/api/dashboard/full`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (!j.ok) {
        setErr(j.error || "Error dashboard");
        return;
      }
      setDash(j);
    } catch (e: any) {
      setErr(e?.message || "Error dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = dash?.user?.worker || null;
  const myStats = dash?.myStats || null;

  const rows = (dash?.rankings?.[rankingType] || []) as any[];

  const myRank = useMemo(() => {
    if (!me?.display_name) return null;
    const idx = rows.findIndex((r) => r.name === me.display_name);
    if (idx === -1) return null;
    return idx + 1;
  }, [me?.display_name, rows]);

  function valueForRow(r: any) {
    if (rankingType === "minutes") return fmt(r.minutes);
    if (rankingType === "captadas") return fmt(r.captadas);
    if (rankingType === "repite_pct") return `${r.repite_pct} %`;
    if (rankingType === "cliente_pct") return `${r.cliente_pct} %`;
    return "";
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Panel</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={loadDashboard} disabled={loading} style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 800 }}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
        <button onClick={logout} style={{ padding: 10, borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 800 }}>
          Cerrar sesión
        </button>
        {dash?.user?.isAdmin ? (
          <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
            Ir a Admin →
          </a>
        ) : null}
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ color: "#666" }}>Mes: <b>{dash?.month_date || "—"}</b></div>
        <div style={{ marginTop: 6 }}>
          Usuario: <b>{me?.display_name || "—"}</b> · Rol: <b>{me?.role || "—"}</b>
        </div>
        <div style={{ marginTop: 6, color: "#666" }}>
          Filas del mes: <b>{fmt(dash?.meta?.totalRowsMonth || 0)}</b>
        </div>
      </div>

      {/* MIS ESTADÍSTICAS */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Mis estadísticas (mes)</h2>
        {myStats ? (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#111" }}>
            <div><b>Minutos:</b> {fmt(myStats.minutes)}</div>
            <div><b>Captadas:</b> {fmt(myStats.captadas)}</div>
            <div><b>% Repite:</b> {myStats.repite_pct} %</div>
            <div><b>% Cliente:</b> {myStats.cliente_pct} %</div>
            <div><b>Desglose:</b> free {fmt(myStats.free)} · rueda {fmt(myStats.rueda)} · cliente {fmt(myStats.cliente)} · repite {fmt(myStats.repite)}</div>
            <div><b>Mi posición:</b> {myRank ? `${medal(myRank)} #${myRank}` : "—"}</div>
          </div>
        ) : (
          <div style={{ color: "#666" }}>Sin datos.</div>
        )}
      </div>

      {/* EQUIPO CENTRAL */}
      {me?.role === "central" ? (
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Mi equipo</h2>
          {dash?.myTeam?.team ? (
            <>
              <div><b>Equipo:</b> {dash.myTeam.team.name}</div>
              {dash?.myTeam?.stats ? (
                <div style={{ marginTop: 6, color: "#111" }}>
                  <b>Minutos equipo:</b> {fmt(dash.myTeam.stats.total_minutes)} ·{" "}
                  <b>Captadas equipo:</b> {fmt(dash.myTeam.stats.total_captadas)} ·{" "}
                  <b>% Cliente equipo:</b> {dash.myTeam.stats.total_cliente_pct} %
                </div>
              ) : (
                <div style={{ color: "#666", marginTop: 6 }}>Tu equipo aún no tiene datos este mes.</div>
              )}
            </>
          ) : (
            <div style={{ color: "#666" }}>
              No tienes equipo creado/asignado aún. (Admin debe crear tu equipo y asignar tarotistas)
            </div>
          )}
        </div>
      ) : null}

      {/* GANADOR DE EQUIPO */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Ganador de equipos (mes)</h2>
        {dash?.winnerTeam ? (
          <div>
            <b>{dash.winnerTeam.team_name}</b> — minutos: <b>{fmt(dash.winnerTeam.total_minutes)}</b> · captadas:{" "}
            <b>{fmt(dash.winnerTeam.total_captadas)}</b> · % cliente: <b>{dash.winnerTeam.total_cliente_pct} %</b>
          </div>
        ) : (
          <div style={{ color: "#666" }}>Aún no hay equipos o no hay datos.</div>
        )}
      </div>

      {/* BONOS */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Bonos del mes (auto)</h2>

        <div style={{ color: "#666", marginBottom: 8 }}>
          (Los importes se cambian en Supabase → tabla <b>bonus_rules</b>)
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Ranking</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Pos</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Persona</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Bono</th>
              </tr>
            </thead>
            <tbody>
              {(dash?.bonuses?.tarotistas || []).map((b: any, i: number) => (
                <tr key={i}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{b.ranking_type}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{b.position}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{b.name}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(b.amount)}</td>
                </tr>
              ))}
              {dash?.bonuses?.centralWinner ? (
                <tr>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>team_win</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>1</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                    Central del equipo: {dash.bonuses.centralWinner.team_name}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    {fmt(dash.bonuses.centralWinner.amount)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* RANKING SELECTOR */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Rankings (mes)</h2>

        <div style={{ marginBottom: 10 }}>
          <select value={rankingType} onChange={(e) => setRankingType(e.target.value as RankingType)} style={{ padding: 8 }}>
            <option value="minutes">1) Ranking por Minutos</option>
            <option value="repite_pct">2) Ranking por % Repite</option>
            <option value="cliente_pct">3) Ranking por % Cliente</option>
            <option value="captadas">4) Ranking por Captadas</option>
          </select>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>#</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tarotista</th>
              <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, idx: number) => {
              const rank = idx + 1;
              const isMe = me?.display_name === r.name;
              return (
                <tr key={r.worker_id} style={{ background: isMe ? "#e8f4ff" : "transparent", fontWeight: isMe ? 800 : 400 }}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                    {medal(rank)} {rank}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{valueForRow(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
          Nota: % Repite = minutos repite / minutos totales del mes. % Cliente igual.
        </div>
      </div>
    </div>
  );
}
