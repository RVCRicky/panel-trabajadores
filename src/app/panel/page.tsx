// src/app/panel/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

function useIsMobile(bp = 900) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [bp]);

  return isMobile;
}

function fmt(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES");
}
function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function medal(pos: number) {
  return pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "";
}

type RankKey = "minutes" | "repite_pct" | "cliente_pct" | "captadas" | "eur_total" | "eur_bonus";

type TeamMember = { worker_id: string; name: string };

type TeamRow = {
  team_id: string;
  team_name: string;
  total_eur_month: number;
  total_minutes: number;
  total_captadas: number;
  member_count: number;

  team_cliente_pct?: number;
  team_repite_pct?: number;
  team_score?: number;

  members?: TeamMember[];
};

type DashboardResp = {
  ok: boolean;
  error?: string;

  month_date: string | null;
  months?: string[];
  user: { isAdmin: boolean; worker: any | null };

  rankings: {
    minutes: any[];
    repite_pct: any[];
    cliente_pct: any[];
    captadas: any[];
    eur_total?: any[];
    eur_bonus?: any[];
  };

  myEarnings: null | {
    minutes_total: number;
    captadas: number;
    amount_base_eur: number;
    amount_bonus_eur: number;
    amount_total_eur: number;
  };

  teamsRanking?: TeamRow[];
  myTeamRank?: number | null;

  winnerTeam: null | {
    team_id: string;
    team_name: string;
    central_user_id?: string | null;
    central_name: string | null;
    total_minutes: number;
    total_captadas: number;
    total_eur_month?: number;
    team_score?: number;
  };

  bonusRules: Array<{
    ranking_type: string;
    position: number;
    role: string;
    amount_eur: number;
    created_at?: string;
    is_active?: boolean;
  }>;

  myIncidentsMonth?: {
    count: number;
    penalty_eur: number;
    grave: boolean;
  };
};

function labelRole(r: string) {
  const key = String(r || "").toLowerCase();
  if (key === "tarotista") return "Tarotista";
  if (key === "central") return "Central";
  if (key === "admin") return "Admin";
  return r;
}

function labelRanking(k: string) {
  const key = String(k || "").toLowerCase();
  if (key === "captadas") return "Captadas";
  if (key === "cliente_pct") return "Clientes %";
  if (key === "repite_pct") return "Repite %";
  if (key === "minutes") return "Minutos";
  if (key === "eur_total") return "€ Total";
  if (key === "eur_bonus") return "€ Bonus";
  return k;
}

function pickRuleAmount(rules: any[], ranking_type: string, role: string, position = 1) {
  const hit = (rules || []).find(
    (x: any) =>
      String(x?.ranking_type || "").toLowerCase() === String(ranking_type).toLowerCase() &&
      String(x?.role || "").toLowerCase() === String(role).toLowerCase() &&
      Number(x?.position) === Number(position) &&
      (x?.is_active === undefined ? true : !!x?.is_active)
  );
  return hit ? Number(hit.amount_eur) || 0 : 0;
}

export default function PanelPage() {
  const router = useRouter();
  const qs = useSearchParams();
  const isMobile = useIsMobile();

  const [rankType, setRankType] = useState<RankKey>("minutes");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState<DashboardResp | null>(null);
  const [didRedirect, setDidRedirect] = useState(false);

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

      const month = qs.get("month_date");
      const q = month ? `?month_date=${encodeURIComponent(month)}` : "";

      const res = await fetch(`/api/dashboard/full${q}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
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

  // si cambias el mes desde el layout, cambia la query y recargamos solo datos
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs?.get("month_date")]);

  const me = data?.user?.worker || null;
  const myRole = String(me?.role || "").toLowerCase();
  const isTarot = myRole === "tarotista";
  const isCentral = myRole === "central";
  const isAdmin = myRole === "admin";

  // ✅ REDIRECT: central/admin no deben quedarse en /panel
  useEffect(() => {
    if (!data?.ok) return;
    if (didRedirect) return;

    const month = qs.get("month_date");
    const q = month ? `?month_date=${encodeURIComponent(month)}` : "";

    if (isCentral) {
      setDidRedirect(true);
      router.replace(`/panel/central${q}`);
      return;
    }

    if (isAdmin) {
      setDidRedirect(true);
      router.replace(`/panel/admin${q}`);
      return;
    }
  }, [data?.ok, didRedirect, isCentral, isAdmin, qs, router]);

  // Tarotistas: no permitir rankType eur_*
  useEffect(() => {
    if (!isTarot) return;
    if (rankType === "eur_total" || rankType === "eur_bonus") setRankType("minutes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTarot]);

  // mientras redirige, no pintes nada (evita “parpadeo”)
  if ((isCentral || isAdmin) && !didRedirect) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <div style={{ fontWeight: 1200, color: "#6b7280" }}>Abriendo tu panel…</div>
      </div>
    );
  }

  const ranks = (data?.rankings as any)?.[rankType] || [];

  const myRank = useMemo(() => {
    const myName = me?.display_name;
    if (!myName) return null;
    const idx = (ranks || []).findIndex((x: any) => x.name === myName);
    return idx === -1 ? null : idx + 1;
  }, [me?.display_name, ranks]);

  function top3For(k: RankKey) {
    const list = (data?.rankings as any)?.[k] || [];
    return (list || []).slice(0, 3);
  }

  function valueOf(k: RankKey, r: any) {
    if (k === "minutes") return fmt(r.minutes);
    if (k === "captadas") return fmt(r.captadas);
    if (k === "repite_pct") return `${r.repite_pct} %`;
    if (k === "cliente_pct") return `${r.cliente_pct} %`;
    if (k === "eur_total") return eur(r.eur_total);
    if (k === "eur_bonus") return eur(r.eur_bonus);
    return "";
  }

  const shellCard: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
  };

  const btnGhost: React.CSSProperties = {
    padding: 12,
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    fontWeight: 1100,
    cursor: "pointer",
    background: "#fff",
    color: "#111",
  };

  // —— MOBILE: rankings as cards
  const RankCards = ({ list, k }: { list: any[]; k: RankKey }) => {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {list.length === 0 ? (
          <div style={{ color: "#6b7280", fontWeight: 900 }}>Sin datos.</div>
        ) : (
          list.map((r: any, idx: number) => {
            const pos = idx + 1;
            const isMe = me?.display_name === r.name;
            return (
              <div
                key={r.worker_id || `${k}-${idx}`}
                style={{
                  border: isMe ? "2px solid #111" : "1px solid #e5e7eb",
                  borderRadius: 16,
                  padding: 12,
                  background: "#fff",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 1300 }}>
                    {medal(pos)} #{pos} <span style={{ fontWeight: 1200 }}>{r.name}</span>
                  </div>
                  <div style={{ fontWeight: 1400 }}>{valueOf(k, r)}</div>
                </div>
                <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
                  {labelRanking(k)}
                  {isMe ? " · (Tú)" : ""}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  };

  const Top3Block = ({ k }: { k: RankKey }) => {
    const list = top3For(k);
    return (
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
        <div style={{ fontWeight: 1200, marginBottom: 8 }}>{labelRanking(k)}</div>
        {list.length === 0 ? (
          <div style={{ color: "#6b7280", fontWeight: 900 }}>Sin datos.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {list.map((r: any, idx: number) => (
              <div
                key={r.worker_id || `${k}-${idx}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: "1px solid #f3f4f6",
                  background: "#fafafa",
                }}
              >
                <div style={{ fontWeight: 1100 }}>
                  {medal(idx + 1)} {idx + 1}. {r.name}
                </div>
                <div style={{ fontWeight: 1400 }}>{valueOf(k, r)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ===== TAROTISTA / ADMIN (en /panel no debería entrar central ya)
  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;
  const incGrave = !!data?.myIncidentsMonth?.grave;

  const minutesTotal = data?.myEarnings?.minutes_total ?? null;
  const captadasTotal = data?.myEarnings?.captadas ?? null;
  const totalEur = data?.myEarnings?.amount_total_eur ?? null;
  const bonusEur = data?.myEarnings?.amount_bonus_eur ?? null;

  return (
    <div style={{ display: "grid", gap: 14, width: "100%" }}>
      {err ? (
        <div style={{ ...shellCard, padding: 14, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 1100 }}>
          {err}
        </div>
      ) : null}

      {/* KPIs */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        <Card>
          <CardTitle>Mi rol</CardTitle>
          <CardValue>{labelRole(me?.role || "—")}</CardValue>
          <CardHint>{me?.display_name ? <>{me.display_name}</> : "—"}</CardHint>
        </Card>

        <Card>
          <CardTitle>Minutos</CardTitle>
          <CardValue>{minutesTotal === null ? "—" : fmt(minutesTotal)}</CardValue>
          <CardHint>Acumulados del mes.</CardHint>
        </Card>

        <Card>
          <CardTitle>Captadas</CardTitle>
          <CardValue>{captadasTotal === null ? "—" : fmt(captadasTotal)}</CardValue>
          <CardHint>Acumuladas del mes.</CardHint>
        </Card>

        <Card>
          <CardTitle>Total € (oficial)</CardTitle>
          <CardValue>{totalEur === null ? "—" : eur(totalEur)}</CardValue>
          <CardHint>Sale de la factura del mes.</CardHint>
        </Card>

        <Card>
          <CardTitle>Bonos</CardTitle>
          <CardValue>{bonusEur === null ? "—" : eur(bonusEur)}</CardValue>
          <CardHint>{incGrave ? <b style={{ color: "#b91c1c" }}>GRAVE: sin bonos</b> : "Según reglas."}</CardHint>
        </Card>

        <Card>
          <CardTitle>Incidencias</CardTitle>
          <CardValue>{incCount == null ? "—" : fmt(incCount)}</CardValue>
          <CardHint>
            Penalización: <b>{incPenalty == null ? "—" : eur(incPenalty)}</b>
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Mi posición</CardTitle>
          <CardValue>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</CardValue>
          <CardHint>Según el ranking seleccionado.</CardHint>
        </Card>
      </div>

      {/* Top 3 */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ fontWeight: 1300, fontSize: 16 }}>Top 3 del mes</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {(["minutes", "captadas", "repite_pct", "cliente_pct"] as RankKey[]).map((k) => (
            <Top3Block key={k} k={k} />
          ))}
        </div>
      </div>

      {/* Ranking */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 1300, fontSize: 16 }}>Ranking</div>
          <div style={{ color: "#6b7280", fontWeight: 1000 }}>
            Mi posición: <b>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</b>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <select
            value={rankType}
            onChange={(e) => setRankType(e.target.value as RankKey)}
            style={{
              padding: 12,
              borderRadius: 14,
              border: "1px solid #e5e7eb",
              background: "#fff",
              width: "100%",
              maxWidth: 520,
              fontWeight: 1100,
            }}
          >
            <option value="minutes">Minutos</option>
            <option value="captadas">Captadas</option>
            <option value="repite_pct">Repite %</option>
            <option value="cliente_pct">Clientes %</option>

            {/* admin puede mirar € si quiere */}
            {isAdmin ? <option value="eur_total">€ Total</option> : null}
            {isAdmin ? <option value="eur_bonus">€ Bonus</option> : null}
          </select>
        </div>

        {isMobile ? (
          <div style={{ marginTop: 12 }}>
            <RankCards list={ranks as any[]} k={rankType} />
          </div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12, WebkitOverflowScrolling: "touch", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 10 }}>#</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 10 }}>Nombre</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #e5e7eb", padding: 10 }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {(ranks as any[]).map((r: any, idx: number) => {
                  const pos = idx + 1;
                  const isMe = me?.display_name === r.name;
                  return (
                    <tr key={r.worker_id || `${idx}`} style={{ background: isMe ? "#eef6ff" : "transparent", fontWeight: isMe ? 1100 : 500 }}>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                        {medal(pos)} {pos}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>{r.name}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", textAlign: "right", fontWeight: 1300 }}>
                        {valueOf(rankType, r)}
                      </td>
                    </tr>
                  );
                })}
                {(ranks as any[]).length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: 12, color: "#6b7280", fontWeight: 900 }}>
                      Sin datos.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
