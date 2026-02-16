"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function fmt(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES");
}
function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function medal(pos: number) {
  return pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "";
}

type DashboardResp = {
  ok: boolean;
  error?: string;

  month_date: string;
  user: { isAdmin: boolean; worker: any | null };

  rankings: {
    minutes: any[];
    repite_pct: any[];
    cliente_pct: any[];
    captadas: any[];
  };

  myEarnings: null | {
    minutes_total: number;
    captadas: number;
    amount_base_eur: number;
    amount_bonus_eur: number;
    amount_total_eur: number;
  };

  allEarnings: null | Array<{
    worker_id: string;
    name: string;
    role: string;
    minutes_total: number;
    captadas: number;
    amount_base_eur: number;
    amount_bonus_eur: number;
    amount_total_eur: number;
  }>;

  bonusRules: Array<{
    ranking_type: string;
    position: number;
    role: string;
    amount_eur: number;
  }>;

  winnerTeam: null | {
    team_id: string;
    team_name: string;
    central_worker_id: string | null;
    central_name: string | null;
    total_minutes: number;
    total_captadas: number;
  };
};

type AdminSortKey = "total" | "minutes" | "captadas" | "base" | "bonus";
type RankKey = "minutes" | "repite_pct" | "cliente_pct" | "captadas";

function labelRanking(k: string) {
  const key = String(k || "").toLowerCase();
  if (key === "captadas") return "Captadas";
  if (key === "cliente_pct") return "Clientes %";
  if (key === "repite_pct") return "Repite %";
  if (key === "minutes") return "Minutos";
  if (key === "team_win") return "Equipo ganador (central)";
  if (key === "team_winner") return "Equipo ganador (extra)";
  return k;
}

function labelRole(r: string) {
  const key = String(r || "").toLowerCase();
  if (key === "tarotista") return "Tarotista";
  if (key === "central") return "Central";
  if (key === "admin") return "Admin";
  return r;
}

export default function PanelPage() {
  const router = useRouter();

  const [rankType, setRankType] = useState<RankKey>("minutes");
  const [adminSort, setAdminSort] = useState<AdminSortKey>("total");

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardResp | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/dashboard/full", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = (await res.json().catch(() => null)) as DashboardResp | null;
      if (!j?.ok) {
        setErr(j?.error || "Error dashboard");
        return;
      }
      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Error dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = data?.user?.worker || null;

  const ranks = data?.rankings?.[rankType] || [];

  const myRank = useMemo(() => {
    const myName = me?.display_name;
    if (!myName) return null;
    const idx = ranks.findIndex((x: any) => x.name === myName);
    return idx === -1 ? null : idx + 1;
  }, [me?.display_name, ranks]);

  const sortedAllEarnings = useMemo(() => {
    const list = data?.allEarnings || [];
    const copy = [...list];
    const val = (x: any) => {
      if (adminSort === "total") return Number(x.amount_total_eur || 0);
      if (adminSort === "minutes") return Number(x.minutes_total || 0);
      if (adminSort === "captadas") return Number(x.captadas || 0);
      if (adminSort === "base") return Number(x.amount_base_eur || 0);
      if (adminSort === "bonus") return Number(x.amount_bonus_eur || 0);
      return 0;
    };
    copy.sort((a, b) => val(b) - val(a));
    return copy;
  }, [data?.allEarnings, adminSort]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function top3For(k: RankKey) {
    const list = data?.rankings?.[k] || [];
    return list.slice(0, 3);
  }

  function leaderNameForRankingType(ranking_type: string): string | null {
    const rt = String(ranking_type || "").toLowerCase();
    if (rt === "captadas") return (data?.rankings?.captadas?.[0]?.name as string) || null;
    if (rt === "cliente_pct") return (data?.rankings?.cliente_pct?.[0]?.name as string) || null;
    if (rt === "repite_pct") return (data?.rankings?.repite_pct?.[0]?.name as string) || null;
    return null; // minutes no se premia
  }

  function valueOf(k: RankKey, r: any) {
    if (k === "minutes") return fmt(r.minutes);
    if (k === "captadas") return fmt(r.captadas);
    if (k === "repite_pct") return `${r.repite_pct} %`;
    if (k === "cliente_pct") return `${r.cliente_pct} %`;
    return "";
  }

  // agrupamos reglas, pero EXCLUIMOS minutos (no hay bono por minutos)
  const bonusRulesGrouped = useMemo(() => {
    const rules = (data?.bonusRules || []).filter((r) => String(r.ranking_type || "").toLowerCase() !== "minutes");
    const map = new Map<string, any[]>();
    for (const r of rules) {
      const key = `${r.role}::${r.ranking_type}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    for (const [k, arr] of map) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [data?.bonusRules]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Panel</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={load} disabled={loading} style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 800 }}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <button
          onClick={logout}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 800 }}
        >
          Cerrar sesión
        </button>

        {data?.user?.isAdmin ? (
          <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
            Ir a Admin →
          </a>
        ) : null}

        <a href="/panel/invoices" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          Mis facturas →
        </a>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>{err}</div>
      ) : null}

      {/* Cabecera */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ color: "#666" }}>
          Mes: <b>{data?.month_date || "—"}</b>
        </div>
        <div style={{ marginTop: 6 }}>
          Usuario: <b>{me?.display_name || "—"}</b> · Rol: <b>{labelRole(me?.role || "—")}</b>
        </div>
      </div>

      {/* TOP 3 */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Top 3 del mes</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {(["minutes", "repite_pct", "cliente_pct", "captadas"] as RankKey[]).map((k) => (
            <div key={k} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>{labelRanking(k)}</div>
              {k === "minutes" ? (
                <div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>
                  (Este ranking es informativo. <b>No tiene bono</b>.)
                </div>
              ) : (
                <div style={{ color: "#666", fontSize: 12, marginBottom: 8 }}>
                  (Este ranking <b>sí</b> tiene bono si hay regla activa.)
                </div>
              )}

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {top3For(k).map((r: any, idx: number) => (
                    <tr key={r.worker_id || `${k}-${idx}`}>
                      <td style={{ padding: 6, borderBottom: "1px solid #f3f3f3", width: 48 }}>
                        {medal(idx + 1)} {idx + 1}
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                      <td style={{ padding: 6, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 800 }}>
                        {valueOf(k, r)}
                      </td>
                    </tr>
                  ))}
                  {top3For(k).length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ padding: 6, color: "#666" }}>
                        Sin datos.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              {(k === "repite_pct" || k === "cliente_pct") && (
                <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
                  % = minutos de ese tipo / minutos totales del mes
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Ganado */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Ganado este mes</h2>

        {data?.myEarnings ? (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#111" }}>
            <div>
              <b>Minutos:</b> {fmt(data.myEarnings.minutes_total)}
            </div>
            <div>
              <b>Captadas:</b> {fmt(data.myEarnings.captadas)}
            </div>
            <div>
              <b>Base:</b> {eur(data.myEarnings.amount_base_eur)}
            </div>
            <div>
              <b>Bonos:</b> {eur(data.myEarnings.amount_bonus_eur)} <span style={{ color: "#666" }}>(cap 20€)</span>
            </div>
            <div>
              <b>Total:</b> {eur(data.myEarnings.amount_total_eur)}
            </div>
          </div>
        ) : (
          <div style={{ color: "#666" }}>Sin cálculo todavía.</div>
        )}
      </div>

      {/* Bonos (reglas + líderes) */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Bonos (reglas + quién va ganando)</h2>

        <div style={{ color: "#666", marginBottom: 10 }}>
          Aquí se ve <b>qué bono existe</b> y <b>quién va líder</b> ahora mismo. Los bonos finales se capan a <b>20€</b> por persona.
        </div>

        <div style={{ padding: 10, border: "1px solid #fff0c2", background: "#fff8df", borderRadius: 10, marginBottom: 12 }}>
          <b>Aclaración centrales:</b> <br />
          • <b>team_win</b> = bono para el <b>central</b> cuyo equipo queda #1 (recomendado). <br />
          • <b>team_winner</b> = bono “extra/antiguo”. Si no tienes claro para qué es, lo normal es <b>no usarlo</b> (dejarlo inactivo).
        </div>

        {[...bonusRulesGrouped.keys()].length === 0 ? (
          <div style={{ color: "#666" }}>No hay reglas activas.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {[...bonusRulesGrouped.entries()].map(([key, rules]) => {
              const [role, ranking_type] = key.split("::");
              const rt = String(ranking_type || "").toLowerCase();

              let leaderLine: string | null = null;

              if (role === "tarotista") {
                const leader = leaderNameForRankingType(ranking_type);
                leaderLine = leader ? `Líder actual: ${leader}` : "Líder actual: —";
              } else if (role === "central" && rt === "team_win") {
                const wt = data?.winnerTeam;
                if (wt?.team_name) {
                  leaderLine = `Gana ahora: ${wt.team_name} (Central: ${wt.central_name || "—"})`;
                } else {
                  leaderLine = "Gana ahora: — (no hay equipos o no hay datos)";
                }
              } else {
                leaderLine = "Líder actual: —";
              }

              return (
                <div key={key} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    {labelRole(role)} · {labelRanking(ranking_type)}
                  </div>

                  <div style={{ marginBottom: 10, color: "#111" }}>
                    <b>{leaderLine}</b>
                  </div>

                  {role === "central" && rt === "team_win" && data?.winnerTeam ? (
                    <div style={{ marginBottom: 10, color: "#666", fontSize: 12 }}>
                      Datos del equipo líder: minutos <b>{fmt(data.winnerTeam.total_minutes)}</b> · captadas{" "}
                      <b>{fmt(data.winnerTeam.total_captadas)}</b>
                    </div>
                  ) : null}

                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Pos</th>
                        <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Bono</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((r: any) => (
                        <tr key={`${key}-${r.position}`}>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                            {medal(r.position)} {r.position}
                          </td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 800 }}>
                            {eur(r.amount_eur)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rankings completos */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Rankings (tabla completa)</h2>

        <div style={{ marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={rankType} onChange={(e) => setRankType(e.target.value as RankKey)} style={{ padding: 8 }}>
            <option value="minutes">Ranking por Minutos (sin bono)</option>
            <option value="repite_pct">Ranking por Repite %</option>
            <option value="cliente_pct">Ranking por Clientes %</option>
            <option value="captadas">Ranking por Captadas</option>
          </select>

          <div style={{ color: "#666" }}>
            Mi posición: <b>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</b>
          </div>
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
            {ranks.map((r: any, idx: number) => {
              const pos = idx + 1;
              const isMe = me?.display_name === r.name;
              return (
                <tr key={r.worker_id} style={{ background: isMe ? "#e8f4ff" : "transparent", fontWeight: isMe ? 800 : 400 }}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                    {medal(pos)} {pos}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    {rankType === "minutes"
                      ? fmt(r.minutes)
                      : rankType === "captadas"
                      ? fmt(r.captadas)
                      : rankType === "repite_pct"
                      ? `${r.repite_pct} %`
                      : rankType === "cliente_pct"
                      ? `${r.cliente_pct} %`
                      : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Admin: Ganado por todos */}
      {data?.user?.isAdmin && data?.allEarnings ? (
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Admin · Ganado por persona (mes)</h2>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#666" }}>Ordenar por:</span>
              <select value={adminSort} onChange={(e) => setAdminSort(e.target.value as AdminSortKey)} style={{ padding: 8 }}>
                <option value="total">Total €</option>
                <option value="base">Base €</option>
                <option value="bonus">Bonos €</option>
                <option value="minutes">Minutos</option>
                <option value="captadas">Captadas</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nombre</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Rol</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Minutos</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Captadas</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Base</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Bonos</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedAllEarnings.map((x) => (
                  <tr key={x.worker_id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      <b>{x.name}</b>
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>{labelRole(x.role)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(x.minutes_total)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(x.captadas)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{eur(x.amount_base_eur)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{eur(x.amount_bonus_eur)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                      <b>{eur(x.amount_total_eur)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>Los bonos están capados a 20€ por persona.</div>
        </div>
      ) : null}
    </div>
  );
}
