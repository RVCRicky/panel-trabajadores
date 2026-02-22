
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

  async function loadPanelMe() {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/panel/me", {
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
      const token = await getToken();// src/app/panel/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

type PresenceState = "offline" | "online" | "pause" | "bathroom";

type PanelMeResp = {
  ok: boolean;
  error?: string;
  month_date: string;
  invoice: null | { id: string; total_eur: number; status: string | null; updated_at: string | null };
  penalty_month_eur: number;
  bonuses_month_eur: number;
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

  const [redirectTo, setRedirectTo] = useState<string | null>(null);

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

  async function loadPanelMe() {
    try {
      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/panel/me", {
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

      const role = String(j?.user?.worker?.role || "").toLowerCase();

      // ✅ Routing por rol (3 paneles separados)
      if (role === "central") {
        setRedirectTo("/panel/central");
        return; // no cargamos presence/panelMe aquí, lo hará el panel central
      }
      if (role === "admin") {
        setRedirectTo("/panel/admin");
        return;
      }

      // Tarotista: se queda en este dashboard
      if (role === "tarotista") {
        await loadPresence();
        await loadPanelMe();
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

  // ✅ ejecuta la redirección por rol cuando ya lo sabemos
  useEffect(() => {
    if (!redirectTo) return;
    router.replace(redirectTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirectTo]);

  useEffect(() => {
    if (!selectedMonth) return;
    if (!data) return;
    if (data.month_date === selectedMonth) return;
    load(selectedMonth);
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
  const isTarot = myRole === "tarotista";

  // ✅ Si es central o admin, NO renderizamos el dashboard de tarotistas
  if (redirectTo) {
    const shellCard: React.CSSProperties = {
      borderRadius: 18,
      border: "1px solid #e5e7eb",
      background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
      boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
    };

    return (
      <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1100 }}>
        <div style={{ ...shellCard, padding: 16 }}>
          <div style={{ fontWeight: 1400, fontSize: 18 }}>Redirigiendo…</div>
          <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>
            Entrando en tu panel: <b>{redirectTo}</b>
          </div>
        </div>
      </div>
    );
  }

  // Tarotistas: no permitir rankType eur_*
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

  const myRank = myRankTarot;

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

  // Totales oficiales (factura)
  const totalEurOfficial = panelMe?.invoice?.total_eur ?? null;
  const bonusOfficial = panelMe?.bonuses_month_eur ?? null;

  const months = data?.months || [];
  const monthLabel = selectedMonth
    ? formatMonthLabel(selectedMonth)
    : data?.month_date
    ? formatMonthLabel(data.month_date)
    : "—";

  const helpText =
    pState === "offline"
      ? "Pulsa “Entrar” para iniciar tu turno."
      : pState === "online"
      ? "Estás online. Si paras, usa Pausa o Baño."
      : "Estás en pausa/baño. Cuando vuelvas, pulsa “Volver (Online)”.";

  const bigActionLabel = pState === "offline" ? "Entrar" : "Salir";
  const bigActionFn = pState === "offline" ? presenceLogin : presenceLogout;

  // Styles
  const shellCard: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
  };

  const btnBase: React.CSSProperties = {
    padding: 12,
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    fontWeight: 1100,
    cursor: "pointer",
    width: isMobile ? "100%" : "auto",
    background: "#fff",
    color: "#111",
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    background: "#111",
    border: "1px solid #111",
    color: "#fff",
  };

  const btnGhost: React.CSSProperties = { ...btnBase };

  // Incidents summary
  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;
  const incGrave = !!data?.myIncidentsMonth?.grave;

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

  // —— Top3 cards (same for mobile/desktop)
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

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1100 }}>
      {/* ===== HEADER compact + semáforo + mes + acciones ===== */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1400, fontSize: 18, lineHeight: 1 }}>Dashboard</div>

              <Badge tone={stateTone as any}>{stateText}</Badge>
              <div style={{ fontWeight: 1400 }}>{formatHMS(elapsedSec)}</div>

              {me?.display_name ? (
                <div style={{ color: "#6b7280", fontWeight: 900 }}>
                  {me.display_name} · {labelRole(me.role || "—")}
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "420px 1fr", gap: 10, alignItems: "end" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Mes</div>
                <select
                  value={selectedMonth || data?.month_date || ""}
                  onChange={(e) => setSelectedMonth(e.target.value || null)}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    fontWeight: 1100,
                    width: "100%",
                  }}
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

              {!isMobile ? (
                <div style={{ color: "#6b7280", fontWeight: 1100, textTransform: "capitalize" }}>{monthLabel}</div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, justifyItems: isMobile ? "stretch" : "end" }}>
            <button
              onClick={() => load(selectedMonth)}
              disabled={loading}
              style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}
            >
              {loading ? "Actualizando…" : "Actualizar"}
            </button>

            <button onClick={logout} style={btnPrimary}>
              Cerrar sesión
            </button>
          </div>
        </div>

        {err ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 900 }}>
            {err}
          </div>
        ) : null}
      </div>

      {/* ===== KPIs (Tarotista) ===== */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Estado</CardTitle>
          <CardValue>
            <Badge tone={stateTone as any}>{stateText}</Badge>
          </CardValue>
          <CardHint>{sessionId ? <>Sesión: <b>{sessionId.slice(0, 8)}…</b></> : "—"}</CardHint>
        </Card>

        <Card>
          <CardTitle>Tiempo</CardTitle>
          <CardValue>{formatHMS(elapsedSec)}</CardValue>
          <CardHint>Se actualiza en tiempo real.</CardHint>
        </Card>

        <Card>
          <CardTitle>Total € del mes</CardTitle>
          <CardValue>{totalEurOfficial === null ? "—" : eur(totalEurOfficial)}</CardValue>
          <CardHint>
            Minutos: <b>{minutesTotal === null ? "—" : fmt(minutesTotal)}</b> · Captadas: <b>{captadasTotal === null ? "—" : fmt(captadasTotal)}</b>
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Bonos ganados</CardTitle>
          <CardValue>{bonusOfficial === null ? "—" : eur(bonusOfficial)}</CardValue>
          <CardHint>{incGrave ? <b style={{ color: "#b91c1c" }}>GRAVE: sin bonos este mes</b> : "Según tu posición actual."}</CardHint>
        </Card>

        <Card>
          <CardTitle>Mi posición</CardTitle>
          <CardValue>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</CardValue>
          <CardHint>Según el ranking seleccionado.</CardHint>
        </Card>

        <Card>
          <CardTitle>Incidencias</CardTitle>
          <CardValue>{incCount == null ? "—" : `${fmt(incCount)}`}</CardValue>
          <CardHint>
            Penalización: <b>{incPenalty == null ? "—" : eur(incPenalty)}</b>
          </CardHint>
        </Card>
      </div>

      {/* ===== Control horario ===== */}
      {me?.role === "tarotista" ? (
        <div style={{ ...shellCard, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 1400, fontSize: 18 }}>🕒 Control horario</div>
              <div style={{ color: "#6b7280", fontWeight: 1000, marginTop: 4 }}>{helpText}</div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Badge tone={stateTone as any}>{stateText}</Badge>
              <div style={{ fontWeight: 1400, fontSize: 16 }}>{formatHMS(elapsedSec)}</div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 1200 }}>Sesión</div>
              <div style={{ marginTop: 6, color: "#6b7280" }}>{sessionId ? <b>{sessionId}</b> : "—"}</div>
              <div style={{ marginTop: 6, color: "#6b7280" }}>
                Inicio: <b>{startedAt ? new Date(startedAt).toLocaleString("es-ES") : "—"}</b>
              </div>
            </div>

            <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
              <div style={{ fontWeight: 1200 }}>Acciones</div>

              <div style={{ marginTop: 10, display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
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
                  Volver
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== Top 3 ===== */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ fontWeight: 1300, fontSize: 16 }}>Top 3 del mes</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {(["minutes", "captadas", "repite_pct", "cliente_pct"] as RankKey[]).map((k) => (
            <Top3Block key={k} k={k} />
          ))}
        </div>
      </div>

      {/* ===== Ranking completo ===== */}
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
                    <tr key={r.worker_id} style={{ background: isMe ? "#eef6ff" : "transparent", fontWeight: isMe ? 1100 : 500 }}>
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
