// src/app/panel/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

function useIsMobile(bp = 720) {
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

type PresenceState = "offline" | "online" | "pause" | "bathroom";

type PanelMeResp = {
  ok: boolean;
  error?: string;
  month_date: string;
  invoice: null | { id: string; total_eur: number; status: string | null; updated_at: string | null };
  penalty_month_eur: number;
  bonuses_month_eur: number;
};

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

function labelRole(r: string) {
  const key = String(r || "").toLowerCase();
  if (key === "tarotista") return "Tarotista";
  if (key === "central") return "Central";
  if (key === "admin") return "Admin";
  return r;
}

function formatHMS(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

function formatMonthLabel(isoMonthDate: string) {
  const [y, m] = String(isoMonthDate || "").split("-");
  const monthNum = Number(m);
  const yearNum = Number(y);
  if (!monthNum || !yearNum) return isoMonthDate;

  const date = new Date(yearNum, monthNum - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

export default function PanelPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [rankType, setRankType] = useState<RankKey>("minutes");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState<DashboardResp | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const [pState, setPState] = useState<PresenceState>("offline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<any>(null);

  const isLogged = pState !== "offline";

  const [panelMe, setPanelMe] = useState<PanelMeResp | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadPresence() {
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/presence/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) return;

      setPState((j.state as PresenceState) || "offline");
      setSessionId(j.session_id || null);
      setStartedAt(j.started_at || null);
    } catch {}
  }

  async function loadPanelMe(monthOverride?: string | null) {
    try {
      const token = await getToken();
      if (!token) return;

      const m = monthOverride ?? selectedMonth ?? null;
      const qs = m ? `?month_date=${encodeURIComponent(m)}` : "";

      const res = await fetch(`/api/panel/me${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = (await res.json().catch(() => null)) as PanelMeResp | null;
      if (!j?.ok) return;

      setPanelMe(j);
    } catch {}
  }

  async function load(monthOverride?: string | null) {
    setErr(null);
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const month = monthOverride ?? selectedMonth ?? null;
      const qs = month ? `?month_date=${encodeURIComponent(month)}` : "";

      const res = await fetch(`/api/dashboard/full${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = (await res.json().catch(() => null)) as DashboardResp | null;
      if (!j?.ok) {
        setErr(j?.error || "Error dashboard");
        return;
      }

      setData(j);

      if (j.month_date && j.month_date !== selectedMonth) {
        setSelectedMonth(j.month_date);
      }

      const role = j?.user?.worker?.role || null;
      if (role === "tarotista" || role === "central") {
        await loadPresence();
        await loadPanelMe(month ?? j.month_date ?? null);
      }
    } catch (e: any) {
      setErr(e?.message || "Error dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function presenceLogin() {
    setErr(null);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");
      if (isLogged) return;

      const res = await fetch("/api/presence/login", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "Error login presencia");

      await loadPresence();
    } catch (e: any) {
      setErr(e?.message || "Error login presencia");
    }
  }

  async function presenceSet(state: PresenceState) {
    setErr(null);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");
      if (!isLogged) return;

      const res = await fetch("/api/presence/state", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "Error cambio estado");

      await loadPresence();
    } catch (e: any) {
      setErr(e?.message || "Error cambio estado");
    }
  }

  async function presenceLogout() {
    setErr(null);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");
      if (!isLogged) return;

      const res = await fetch("/api/presence/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "Error logout presencia");

      await loadPresence();
    } catch (e: any) {
      setErr(e?.message || "Error logout presencia");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    load(selectedMonth);
    loadPanelMe(selectedMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);

  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);

    if (!startedAt || pState === "offline") {
      setElapsedSec(0);
      return;
    }

    const startMs = new Date(startedAt).getTime();
    const update = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    update();

    tickRef.current = setInterval(update, 1000);
    return () => tickRef.current && clearInterval(tickRef.current);
  }, [startedAt, pState]);

  const me = data?.user?.worker || null;
  const myRole = String(me?.role || "").toLowerCase();
  const isCentral = myRole === "central";
  const isTarot = myRole === "tarotista";

  // ✅ Tarotistas: nunca mostrar ranking € en selector
  useEffect(() => {
    if (!isTarot) return;
    if (rankType === "eur_total" || rankType === "eur_bonus") setRankType("minutes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTarot]);

  const ranks = (data?.rankings as any)?.[rankType] || [];

  const myRankTarot = useMemo(() => {
    const myName = me?.display_name;
    if (!myName) return null;
    const idx = ranks.findIndex((x: any) => x.name === myName);
    return idx === -1 ? null : idx + 1;
  }, [me?.display_name, ranks]);

  const myRank = isCentral ? (data?.myTeamRank ?? null) : myRankTarot;

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

  const stateTone = pState === "online" ? "ok" : pState === "pause" || pState === "bathroom" ? "warn" : "neutral";
  const stateText = pState === "online" ? "ONLINE" : pState === "pause" ? "PAUSA" : pState === "bathroom" ? "BAÑO" : "OFFLINE";

  const minutesTotal = data?.myEarnings?.minutes_total ?? null;
  const captadasTotal = data?.myEarnings?.captadas ?? null;

  // ✅ Totales oficiales (panel-me)
  const totalEurOfficial = panelMe?.invoice?.total_eur ?? null;
  const bonusOfficial = panelMe?.bonuses_month_eur ?? null;

  const months = data?.months || [];
  const monthLabel = selectedMonth
    ? formatMonthLabel(selectedMonth)
    : data?.month_date
    ? formatMonthLabel(data.month_date)
    : "—";

  const teams = data?.teamsRanking || [];
  const team1 = teams[0] || null;
  const team2 = teams[1] || null;

  const bonusTeamWinner = useMemo(() => {
    const rules = data?.bonusRules || [];
    const r = rules.find(
      (x) =>
        String(x.ranking_type || "").toLowerCase() === "team_winner" &&
        Number(x.position) === 1 &&
        String(x.role || "").toLowerCase() === "central" &&
        (x.is_active === undefined ? true : !!x.is_active)
    );
    return r ? Number(r.amount_eur) || 0 : 0;
  }, [data?.bonusRules]);

  const helpText =
    pState === "offline"
      ? "Pulsa “Entrar a trabajar” para iniciar tu turno."
      : pState === "online"
      ? "Estás online. Si paras, usa Pausa o Baño."
      : "Estás en pausa/baño. Cuando vuelvas, pulsa “Volver (Online)”.";

  const bigActionLabel = pState === "offline" ? "Entrar a trabajar" : "Salir del turno";
  const bigActionFn = pState === "offline" ? presenceLogin : presenceLogout;

  const btnBase: React.CSSProperties = {
    padding: 12,
    borderRadius: 14,
    border: "1px solid #111",
    fontWeight: 1000,
    cursor: "pointer",
    width: isMobile ? "100%" : "auto",
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: "#111",
    color: "#fff",
  };

  const btnGhost: React.CSSProperties = {
    ...btnBase,
    background: "#fff",
    color: "#111",
    border: "1px solid #e5e7eb",
  };

  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;
  const incGrave = !!data?.myIncidentsMonth?.grave;

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: "100%" }}>
      {/* ===== Header ===== */}
      <div
        style={{
          border: "2px solid #111",
          borderRadius: 18,
          padding: 14,
          background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
        }}
      >
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "1fr auto", alignItems: "start" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, lineHeight: 1.1, fontSize: 22, fontWeight: 1200 }}>Panel</h1>
              <div style={{ color: "#6b7280", textTransform: "capitalize", fontWeight: 1000 }}>{monthLabel}</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Badge tone={stateTone as any}>{stateText}</Badge>
              <div style={{ fontWeight: 1100, color: "#111" }}>{formatHMS(elapsedSec)}</div>
              {me?.display_name ? (
                <div style={{ color: "#6b7280", fontWeight: 900 }}>
                  {me.display_name} · {labelRole(me.role || "—")}
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: 8, width: "100%" }}>
              <div style={{ color: "#6b7280", fontWeight: 1000 }}>Mes</div>
              <select
                value={selectedMonth || data?.month_date || ""}
                onChange={(e) => setSelectedMonth(e.target.value || null)}
                style={{ padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", width: "100%", maxWidth: "100%" }}
                disabled={loading || months.length === 0}
              >
                {months.length === 0 ? (
                  <option value="">{data?.month_date || "—"}</option>
                ) : (
                  months.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, justifyItems: isMobile ? "stretch" : "end" }}>
            <button
              onClick={() => load(selectedMonth)}
              disabled={loading}
              style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}
            >
              {loading ? "Actualizando..." : "Actualizar"}
            </button>

            <button onClick={logout} style={btnPrimary}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10 }}>
          {err}
        </div>
      ) : null}

      {/* ===== Equipos (si central) ===== */}
      {isCentral && teams.length > 0 ? (
        <div style={{ border: "2px solid #111", borderRadius: 18, padding: 14, background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 1100, fontSize: 18 }}>🏆 Ranking por equipos (GLOBAL)</div>
            <div style={{ color: "#666", fontWeight: 900 }}>
              Criterio: <b>%Clientes + %Repite</b>
              {bonusTeamWinner ? (
                <>
                  {" "}
                  · Bono ganadora: <b>{eur(bonusTeamWinner)}</b>
                </>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto 1fr", gap: 12, alignItems: "stretch", marginTop: 12 }}>
            {[team1, team2].map((t, idx) => {
              const pos = idx + 1;
              const isMine = (data?.myTeamRank || 0) === pos;

              return (
                <div
                  key={pos}
                  style={{
                    border: isMine ? "2px solid #111" : "1px solid #eaeaea",
                    borderRadius: 16,
                    padding: 12,
                    background: isMine ? "#fff" : "#fcfcfc",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 1100, fontSize: 16 }}>{t ? `${medal(pos)} #${pos} ${t.team_name}` : "—"}</div>
                    {isMine ? <span style={{ border: "1px solid #111", borderRadius: 999, padding: "4px 10px", fontWeight: 1000 }}>Tu equipo</span> : null}
                  </div>

                  <div style={{ fontSize: 34, fontWeight: 1300, marginTop: 10 }}>
                    {t?.team_score ?? "—"} <span style={{ fontSize: 14, fontWeight: 1000, color: "#666" }}>score</span>
                  </div>

                  <div style={{ color: "#666", marginTop: 6, fontWeight: 900 }}>
                    Clientes: <b>{t?.team_cliente_pct ?? "—"}%</b> · Repite: <b>{t?.team_repite_pct ?? "—"}%</b>
                  </div>

                  <div style={{ color: "#666", marginTop: 6 }}>
                    Minutos: <b>{t ? fmt(t.total_minutes) : "—"}</b> · Captadas: <b>{t ? fmt(t.total_captadas) : "—"}</b>
                  </div>

                  <div style={{ marginTop: 10, fontWeight: 1000 }}>Tarotistas del equipo</div>
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(t?.members || []).map((m) => (
                      <span key={m.worker_id} style={{ border: "1px solid #e6e6e6", borderRadius: 999, padding: "6px 10px", fontWeight: 900, background: "#fff" }}>
                        {m.name}
                      </span>
                    ))}
                    {(t?.members || []).length === 0 ? <span style={{ color: "#999" }}>Sin tarotistas asignadas.</span> : null}
                  </div>
                </div>
              );
            })}

            {!isMobile ? (
              <div style={{ display: "grid", placeItems: "center", padding: 6 }}>
                <div style={{ fontWeight: 1100, color: "#666" }}>VS</div>
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 10, color: "#666", fontWeight: 900 }}>
            Tu equipo va: <b>{data?.myTeamRank ? `${medal(data.myTeamRank)} #${data.myTeamRank}` : "—"}</b>
          </div>
        </div>
      ) : null}

      {/* ===== KPIs ===== */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Estado</CardTitle>
          <CardValue>
            <Badge tone={stateTone as any}>{stateText}</Badge>
          </CardValue>
          <CardHint>{sessionId ? <>Sesión: <b>{sessionId.slice(0, 8)}…</b></> : "—"}</CardHint>
        </Card>

        <Card>
          <CardTitle>Tiempo logueado</CardTitle>
          <CardValue>{formatHMS(elapsedSec)}</CardValue>
          <CardHint>Se actualiza en tiempo real.</CardHint>
        </Card>

        {isTarot ? (
          <>
            <Card>
              <CardTitle>Total € del mes</CardTitle>
              <CardValue>{totalEurOfficial === null ? "—" : eur(totalEurOfficial)}</CardValue>
              <CardHint>
                Minutos: <b>{minutesTotal === null ? "—" : fmt(minutesTotal)}</b> · Captadas:{" "}
                <b>{captadasTotal === null ? "—" : fmt(captadasTotal)}</b>
              </CardHint>
            </Card>

            <Card>
              <CardTitle>Bonos ganados (mes)</CardTitle>
              <CardValue>{bonusOfficial === null ? "—" : eur(bonusOfficial)}</CardValue>
              <CardHint>Fuente oficial: worker_invoices / líneas.</CardHint>
            </Card>
          </>
        ) : isCentral ? (
          <Card>
            <CardTitle>Bono del mes</CardTitle>
            <CardValue>{data?.myEarnings?.amount_bonus_eur == null ? "—" : eur(data.myEarnings.amount_bonus_eur)}</CardValue>
            <CardHint>Solo se muestra el bono por posición del equipo.</CardHint>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Mi posición (ranking actual)</CardTitle>
          <CardValue>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</CardValue>
          <CardHint>{isCentral ? "Según ranking global de equipos." : "Según el ranking seleccionado abajo."}</CardHint>
        </Card>

        {(isTarot || isCentral) ? (
          <Card>
            <CardTitle>Incidencias del mes</CardTitle>
            <CardValue>{incCount == null ? "—" : `${fmt(incCount)} incidencias`}</CardValue>
            <CardHint>
              Penalización: <b>{incPenalty == null ? "—" : eur(incPenalty)}</b>
              {incGrave ? (
                <>
                  {" "}
                  · <b style={{ color: "#b91c1c" }}>GRAVE: sin bonos este mes</b>
                </>
              ) : null}
            </CardHint>
          </Card>
        ) : null}
      </div>

      {/* ===== Control horario ===== */}
      {me?.role === "tarotista" || me?.role === "central" ? (
        <div style={{ border: "2px solid #111", borderRadius: 18, padding: 14, background: "linear-gradient(180deg, #ffffff 0%, #fbfbfb 100%)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 1200, fontSize: 20 }}>🕒 Control horario</div>
              <div style={{ color: "#666", fontWeight: 900, marginTop: 4 }}>
                {me?.display_name || "—"} · {labelRole(me?.role || "—")} · Mes: <b>{selectedMonth || data?.month_date || "—"}</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Badge tone={stateTone as any}>{stateText}</Badge>
              <div style={{ fontWeight: 1200, fontSize: 18 }}>{formatHMS(elapsedSec)}</div>
            </div>
          </div>

          <div style={{ marginTop: 10, color: "#666", fontWeight: 900 }}>{helpText}</div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 1100 }}>Sesión</div>
              <div style={{ marginTop: 6, color: "#666" }}>{sessionId ? <b>{sessionId}</b> : "—"}</div>
              <div style={{ marginTop: 6, color: "#666" }}>
                Inicio: <b>{startedAt ? new Date(startedAt).toLocaleString("es-ES") : "—"}</b>
              </div>
            </div>

            <div style={{ border: "1px solid #eee", borderRadius: 14, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 1100 }}>Acciones</div>

              <div style={{ marginTop: 10, display: "grid", gap: 10, gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
                <button onClick={bigActionFn} style={pState === "offline" ? btnPrimary : btnGhost}>
                  {bigActionLabel}
                </button>

                <button onClick={loadPresence} style={btnGhost}>
                  Refrescar
                </button>

                <button onClick={() => presenceSet("pause")} disabled={!isLogged} style={!isLogged ? { ...btnGhost, opacity: 0.5, cursor: "not-allowed" } : btnGhost}>
                  Pausa
                </button>

                <button onClick={() => presenceSet("bathroom")} disabled={!isLogged} style={!isLogged ? { ...btnGhost, opacity: 0.5, cursor: "not-allowed" } : btnGhost}>
                  Baño
                </button>

                <button onClick={() => presenceSet("online")} disabled={!isLogged} style={!isLogged ? { ...btnGhost, opacity: 0.5, cursor: "not-allowed" } : btnGhost}>
                  Volver (Online)
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== Top 3 ===== */}
      <Card>
        <CardTitle>Top 3 del mes</CardTitle>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 10 }}>
          {(isCentral
            ? (["minutes", "captadas"] as RankKey[])
            : isTarot
            ? (["minutes", "captadas", "repite_pct", "cliente_pct"] as RankKey[])
            : (["minutes", "repite_pct", "cliente_pct", "captadas"] as RankKey[])
          ).map((k) => (
            <div key={k} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 1000, marginBottom: 6 }}>{labelRanking(k)}</div>

              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {top3For(k).map((r: any, idx: number) => (
                    <tr key={r.worker_id || `${k}-${idx}`}>
                      <td style={{ padding: 6, borderBottom: "1px solid #f3f3f3", width: 54 }}>
                        {medal(idx + 1)} {idx + 1}
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                      <td style={{ padding: 6, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>
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
            </div>
          ))}
        </div>
      </Card>

      {/* ===== Ranking completo ===== */}
      <Card>
        <CardTitle>Rankings (tabla completa)</CardTitle>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <select
            value={rankType}
            onChange={(e) => setRankType(e.target.value as RankKey)}
            style={{ padding: 12, borderRadius: 12, border: "1px solid #ddd", width: "100%", maxWidth: 520 }}
          >
            {isTarot ? (
              <>
                <option value="minutes">Ranking por Minutos</option>
                <option value="captadas">Ranking por Captadas</option>
                <option value="repite_pct">Ranking por Repite %</option>
                <option value="cliente_pct">Ranking por Clientes %</option>
              </>
            ) : isCentral ? (
              <>
                <option value="minutes">Ranking por Minutos</option>
                <option value="captadas">Ranking por Captadas</option>
              </>
            ) : (
              <>
                <option value="minutes">Ranking por Minutos</option>
                <option value="repite_pct">Ranking por Repite %</option>
                <option value="cliente_pct">Ranking por Clientes %</option>
                <option value="captadas">Ranking por Captadas</option>
              </>
            )}
          </select>

          <div style={{ color: "#666" }}>
            Mi posición: <b>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</b>
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 10, WebkitOverflowScrolling: "touch", width: "100%" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>#</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nombre</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {ranks.map((r: any, idx: number) => {
                const pos = idx + 1;
                const isMe = me?.display_name === r.name;
                return (
                  <tr key={r.worker_id || `${pos}-${r.name}`} style={{ background: isMe ? "#e8f4ff" : "transparent", fontWeight: isMe ? 900 : 400 }}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      {medal(pos)} {pos}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{valueOf(rankType, r)}</td>
                  </tr>
                );
              })}
              {ranks.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 10, color: "#666" }}>
                    Sin datos.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
