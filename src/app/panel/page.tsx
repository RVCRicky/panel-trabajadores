"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type WorkerRole = "admin" | "central" | "tarotista";
type RankingType = "minutes" | "repite_pct" | "cliente_pct" | "captadas";

function fmt(n: number) {
  return (Number(n) || 0).toLocaleString("es-ES");
}
function fmtMoney(n: number) {
  return (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function medal(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "";
}

function rankingLabel(t: RankingType) {
  if (t === "minutes") return "Minutos";
  if (t === "repite_pct") return "% Repite";
  if (t === "cliente_pct") return "% Cliente";
  return "Captadas";
}

export default function PanelPage() {
  const router = useRouter();

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [worker, setWorker] = useState<any>(null);
  const [periods, setPeriods] = useState<any[]>([]);
  const [month, setMonth] = useState<string>("");

  const [rankingType, setRankingType] = useState<RankingType>("minutes");

  const [my, setMy] = useState<any>(null);
  const [myRanks, setMyRanks] = useState<any>(null);
  const [myBonuses, setMyBonuses] = useState<any[]>([]);

  const [rankings, setRankings] = useState<any>(null);
  const [teamStats, setTeamStats] = useState<any[]>([]);
  const [teamWinner, setTeamWinner] = useState<any>(null);

  async function getTokenOrRedirect() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || null;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function loadDashboard(targetMonth?: string) {
    setErr(null);
    setLoading(true);

    try {
      const token = await getTokenOrRedirect();
      if (!token) return;

      const m = targetMonth || month || "";
      const qs = m ? `?month=${encodeURIComponent(m)}` : "";
      const r = await fetch(`/api/dashboard/full${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();

      if (!j.ok) {
        setErr(j.error || "Error dashboard");
        return;
      }

      setWorker(j.worker);
      setPeriods(j.periods || []);
      setMonth(j.month || "");
      setMy(j.my || null);
      setMyRanks(j.myRanks || null);
      setMyBonuses(j.myBonuses || []);

      setRankings(j.tarotistasRankings || null);
      setTeamStats(j.teamStats || []);
      setTeamWinner(j.teamWinner || null);
    } catch (e: any) {
      setErr(e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadDashboard();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const rows = useMemo(() => {
    if (!rankings) return [];
    return rankings[rankingType] || [];
  }, [rankings, rankingType]);

  const myRankNow = useMemo(() => {
    if (!worker) return null;
    const idx = rows.findIndex((r: any) => r.worker_id === worker.id);
    return idx === -1 ? null : idx + 1;
  }, [rows, worker]);

  const myBonusTotal = useMemo(() => {
    return (myBonuses || []).reduce((acc, b) => acc + (Number(b.amount) || 0), 0);
  }, [myBonuses]);

  function valueForRow(r: any) {
    if (rankingType === "minutes") return fmt(r.minutes);
    if (rankingType === "captadas") return fmt(r.captadas);
    if (rankingType === "repite_pct") return `${r.repite_pct} %`;
    if (rankingType === "cliente_pct") return `${r.cliente_pct} %`;
    return "";
  }

  return (
    <div style={{ padding: 18, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Panel de Trabajadores</h1>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        {worker ? (
          <div style={{ color: "#444" }}>
            Usuario: <b>{worker.display_name}</b> · Rol: <b>{worker.role}</b>
          </div>
        ) : (
          <div>Cargando usuario…</div>
        )}
      </div>

      {/* Controles */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Mes</div>
          <select
            value={month}
            onChange={(e) => {
              const m = e.target.value;
              setMonth(m);
              loadDashboard(m);
            }}
            style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
          >
            {periods?.length ? (
              periods.map((p: any) => (
                <option key={p.month_date} value={p.month_date}>
                  {p.month_date} · {p.label}
                </option>
              ))
            ) : (
              <option value={month || ""}>{month || "—"}</option>
            )}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Ranking</div>
          <select
            value={rankingType}
            onChange={(e) => setRankingType(e.target.value as RankingType)}
            style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
          >
            <option value="minutes">Minutos</option>
            <option value="repite_pct">% Repite</option>
            <option value="cliente_pct">% Cliente</option>
            <option value="captadas">Captadas</option>
          </select>
        </div>

        <button
          onClick={() => loadDashboard(month)}
          disabled={loading}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #111",
            background: loading ? "#eee" : "#fff",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 800,
            height: 40,
            alignSelf: "flex-end",
          }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {/* Mis datos */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 10px 0", fontSize: 18 }}>Mi resumen del mes</h2>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ minWidth: 200 }}>
            <div style={{ color: "#666", fontSize: 12 }}>Minutos</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{fmt(my?.minutes || 0)}</div>
          </div>

          <div style={{ minWidth: 200 }}>
            <div style={{ color: "#666", fontSize: 12 }}>Captadas</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{fmt(my?.captadas || 0)}</div>
          </div>

          <div style={{ minWidth: 240 }}>
            <div style={{ color: "#666", fontSize: 12 }}>Mi posición ({rankingLabel(rankingType)})</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {myRankNow ? `${medal(myRankNow)} #${myRankNow}` : "—"}
            </div>
            <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
              También: Minutos #{myRanks?.minutes ?? "—"} · %Repite #{myRanks?.repite_pct ?? "—"} · %Cliente #{myRanks?.cliente_pct ?? "—"} · Captadas #{myRanks?.captadas ?? "—"}
            </div>
          </div>

          <div style={{ minWidth: 240 }}>
            <div style={{ color: "#666", fontSize: 12 }}>Bonos del mes (auto)</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{fmtMoney(myBonusTotal)} €</div>
            <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
              {myBonuses?.length ? `${myBonuses.length} bono(s) aplicado(s)` : "Sin bonos por ahora"}
            </div>
          </div>
        </div>

        {/* detalle bonos */}
        {myBonuses?.length ? (
          <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Detalle bonos</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {myBonuses.map((b: any, i: number) => (
                <li key={i}>
                  {b.ranking_type} · puesto #{b.position} · <b>{fmtMoney(b.amount)} €</b>
                  {b.team_name ? ` · equipo: ${b.team_name}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Ranking */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <h2 style={{ margin: "0 0 10px 0", fontSize: 18 }}>Ranking ({rankingLabel(rankingType)})</h2>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>#</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tarotista</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>{rankingLabel(rankingType)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, idx: number) => {
                const rank = idx + 1;
                const isMe = worker?.id === r.worker_id;

                return (
                  <tr
                    key={r.worker_id}
                    style={{
                      background: isMe ? "#e8f4ff" : "transparent",
                      fontWeight: isMe ? 800 : 400,
                    }}
                  >
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      {medal(rank)} {rank}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                      {valueForRow(r)}
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={3} style={{ padding: 10, color: "#666" }}>
                    Sin datos este mes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Equipos (central/admin) */}
      {worker?.role === "central" || worker?.role === "admin" ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <h2 style={{ margin: "0 0 10px 0", fontSize: 18 }}>Equipos (centrales)</h2>

          {teamWinner ? (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, border: "1px solid #d7f0d7", background: "#f3fff3" }}>
              Ganador del mes: <b>{teamWinner.team_name}</b> (central: <b>{teamWinner.central_name}</b>) · minutos: <b>{fmt(teamWinner.total_minutes)}</b>
            </div>
          ) : (
            <div style={{ color: "#666", marginBottom: 10 }}>Aún no hay equipos configurados.</div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Equipo</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Central</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Minutos equipo</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Captadas</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>% Cliente</th>
                </tr>
              </thead>
              <tbody>
                {teamStats.map((t: any) => {
                  const isWinner = teamWinner && t.team_id === teamWinner.team_id;
                  return (
                    <tr key={t.team_id} style={{ background: isWinner ? "#fff7e6" : "transparent", fontWeight: isWinner ? 800 : 400 }}>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{isWinner ? "🏆 " : ""}{t.team_name}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{t.central_name}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(t.total_minutes)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(t.total_captadas)}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{t.team_cliente_pct} %</td>
                    </tr>
                  );
                })}
                {!teamStats.length ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 10, color: "#666" }}>
                      No hay equipos aún. (Admin debe crear teams y asignar tarotistas)
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
