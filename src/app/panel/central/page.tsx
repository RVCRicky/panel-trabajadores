// src/app/panel/central/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

type PresenceState = "offline" | "online" | "pause" | "bathroom";

type DashboardResp = {
  ok: boolean;
  error?: string;

  month_date: string | null;
  months?: string[];
  user: { isAdmin: boolean; worker: any | null };

  rankings: {
    minutes?: any[];
    repite_pct?: any[];
    cliente_pct?: any[];
    captadas?: any[];
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

  myIncidentsMonth?: { count: number; penalty_eur: number; grave: boolean };

  teamsRanking?: any[];
  myTeamRank?: number | null;
  winnerTeam?: any;
  bonusRules?: any[];
};

type PresenceMeResp = { ok: boolean; state: PresenceState; session_id: string | null; started_at: string | null; error?: string };

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
function formatHMS(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

type Recommendation = { tone: "ok" | "warn"; title: string; body: string };

export default function CentralPanelPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  // ✅ APAGA el header duplicado aquí
  const SHOW_LOCAL_HEADER = false;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [data, setData] = useState<DashboardResp | null>(null);

  const [pState, setPState] = useState<PresenceState>("offline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<any>(null);

  const isLogged = pState !== "offline";

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadDashboard() {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      // usa month_date desde la URL si existe (lo cambia el layout)
      const u = new URL(window.location.href);
      const month = u.searchParams.get("month_date");
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

      const role = String(j?.user?.worker?.role || "").toLowerCase();
      if (role !== "central") {
        router.replace("/panel");
        return;
      }

      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Error dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function loadPresence() {
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/presence/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = (await res.json().catch(() => null)) as PresenceMeResp | null;
      if (!j?.ok) return;

      setPState(j.state || "offline");
      setSessionId(j.session_id || null);
      setStartedAt(j.started_at || null);
    } catch {}
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

  useEffect(() => {
    loadDashboard();
    loadPresence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const stateTone = pState === "online" ? "ok" : pState === "pause" || pState === "bathroom" ? "warn" : "neutral";
  const stateText = pState === "online" ? "ONLINE" : pState === "pause" ? "PAUSA" : pState === "bathroom" ? "BAÑO" : "OFFLINE";

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
  const btnPrimary: React.CSSProperties = { ...btnBase, background: "#111", border: "1px solid #111", color: "#fff" };
  const btnGhost: React.CSSProperties = { ...btnBase };

  const shellCard: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
  };

  const teams = Array.isArray(data?.teamsRanking) ? (data?.teamsRanking as any[]) : [];
  const hasTeams = teams.length > 0;

  const recommendations: Recommendation[] = useMemo(() => {
    const out: Recommendation[] = [];
    const cap = (data?.rankings?.captadas || []) as any[];
    const cli = (data?.rankings?.cliente_pct || []) as any[];
    const rep = (data?.rankings?.repite_pct || []) as any[];

    const topCap = cap[0];
    const topCli = cli[0];
    const topRep = rep[0];

    const lowCli = [...cli].reverse()[0];
    const lowRep = [...rep].reverse()[0];

    if (topCap?.name) out.push({ tone: "ok", title: "Captación fuerte", body: `${topCap.name} está captando mucho últimamente.` });
    if (topCli?.name) out.push({ tone: "ok", title: "Clientes nuevos", body: `${topCli.name} tiene un %Clientes muy alto.` });
    if (topRep?.name) out.push({ tone: "ok", title: "Fidelización", body: `${topRep.name} está fidelizando muy bien (%Repite).` });
    if (lowCli?.name) out.push({ tone: "warn", title: "Ojo con %Clientes", body: `${lowCli.name} está baja en %Clientes.` });
    if (lowRep?.name) out.push({ tone: "warn", title: "Ojo con %Repite", body: `${lowRep.name} está baja en %Repite.` });

    return [...out].sort(() => Math.random() - 0.5).slice(0, 4);
  }, [data?.rankings?.captadas, data?.rankings?.cliente_pct, data?.rankings?.repite_pct]);

  const bonusRules = Array.isArray(data?.bonusRules) ? data!.bonusRules! : [];
  const teamWinnerRule = bonusRules.find((x: any) => String(x?.ranking_type || "").toLowerCase() === "team_winner" && Number(x?.position) === 1 && String(x?.role || "").toLowerCase() === "central");
  const bonusTeamWinner = teamWinnerRule ? eur(teamWinnerRule.amount_eur) : eur(0);

  const myTeamRank = data?.myTeamRank ?? null;
  const winnerTeam = data?.winnerTeam ?? null;

  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;

  const bigActionLabel = pState === "offline" ? "Entrar" : "Salir";
  const bigActionFn = pState === "offline" ? presenceLogin : presenceLogout;

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1100 }}>
      {SHOW_LOCAL_HEADER ? (
        <div style={{ ...shellCard, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1400, fontSize: 18 }}>Central</div>
              <Badge tone={stateTone as any}>{stateText}</Badge>
              <div style={{ fontWeight: 1400 }}>{formatHMS(elapsedSec)}</div>
            </div>
            <button onClick={loadDashboard} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}>
              {loading ? "Actualizando…" : "Actualizar"}
            </button>
          </div>

          {err ? (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 900 }}>
              {err}
            </div>
          ) : null}
        </div>
      ) : err ? (
        <div style={{ ...shellCard, padding: 14, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 900 }}>{err}</div>
      ) : null}

      {/* Equipos */}
      <div style={{ ...shellCard, padding: 14, border: "1px solid #111" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 1300, fontSize: 18 }}>🏆 Equipos (GLOBAL)</div>
          <button onClick={loadDashboard} style={btnGhost}>
            Actualizar
          </button>
        </div>
        <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>
          Score basado en <b>%Clientes + %Repite</b>
        </div>

        {!hasTeams ? (
          <div style={{ marginTop: 12, color: "#6b7280", fontWeight: 1000 }}>Sin datos de equipos para este mes.</div>
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {teams.slice(0, 5).map((t: any, idx: number) => (
              <div key={t.team_id || idx} style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 1300 }}>
                    {medal(idx + 1)} {idx + 1}. {t.team_name || "Equipo"}
                  </div>
                  <div style={{ fontWeight: 1200 }}>Score: {fmt(t.team_score ?? 0)}</div>
                </div>
                <div style={{ marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap", color: "#6b7280", fontWeight: 1000 }}>
                  <span>Minutos: <b style={{ color: "#111" }}>{fmt(t.total_minutes ?? 0)}</b></span>
                  <span>Captadas: <b style={{ color: "#111" }}>{fmt(t.total_captadas ?? 0)}</b></span>
                  <span>%Clientes: <b style={{ color: "#111" }}>{fmt(t.team_cliente_pct ?? 0)}</b></span>
                  <span>%Repite: <b style={{ color: "#111" }}>{fmt(t.team_repite_pct ?? 0)}</b></span>
                  <span>€ mes: <b style={{ color: "#111" }}>{eur(t.total_eur_month ?? 0)}</b></span>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
                <div style={{ fontWeight: 1200 }}>Mi equipo</div>
                <div style={{ marginTop: 6, fontWeight: 1400, fontSize: 22 }}>{myTeamRank ? `#${myTeamRank}` : "—"}</div>
                <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>Posición de tu equipo este mes.</div>
              </div>

              <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
                <div style={{ fontWeight: 1200 }}>Equipo ganador</div>
                <div style={{ marginTop: 6, fontWeight: 1300 }}>{winnerTeam?.team_name || "—"}</div>
                <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>Score: <b style={{ color: "#111" }}>{fmt(winnerTeam?.team_score ?? 0)}</b></div>
              </div>

              <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
                <div style={{ fontWeight: 1200 }}>Bono ganador</div>
                <div style={{ marginTop: 6, fontWeight: 1400, fontSize: 22 }}>{bonusTeamWinner}</div>
                <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>Solo si tu equipo va #1.</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
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

        <Card>
          <CardTitle>Bono (backend)</CardTitle>
          <CardValue>{eur(data?.myEarnings?.amount_bonus_eur ?? 0)}</CardValue>
          <CardHint>Calculado por el endpoint.</CardHint>
        </Card>

        <Card>
          <CardTitle>Incidencias (mes)</CardTitle>
          <CardValue>{incCount == null ? "—" : fmt(incCount)}</CardValue>
          <CardHint>
            Penalización: <b>{incPenalty == null ? "—" : eur(incPenalty)}</b>
          </CardHint>
        </Card>
      </div>

      {/* Control horario */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 1400, fontSize: 18 }}>🕒 Control horario</div>
            <div style={{ color: "#6b7280", fontWeight: 1000, marginTop: 4 }}>{pState === "offline" ? "Pulsa “Entrar” para iniciar tu turno." : "Gestiona tu estado durante el turno."}</div>
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

              <button onClick={loadDashboard} style={btnGhost}>
                Refrescar datos
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Recomendaciones */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ fontWeight: 1400, fontSize: 18 }}>💡 Recomendaciones</div>
        <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 1000 }}>Generadas automáticamente según rankings del mes.</div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {recommendations.length === 0 ? (
            <div style={{ padding: 12, borderRadius: 16, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 1000 }}>
              Sin suficientes datos para recomendaciones.
            </div>
          ) : (
            recommendations.map((r, idx) => (
              <div key={idx} style={{ padding: 12, borderRadius: 16, border: r.tone === "warn" ? "1px solid #fed7aa" : "1px solid #d1fae5", background: "#fff" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge tone={r.tone as any}>{r.tone === "warn" ? "OJO" : "OK"}</Badge>
                  <div style={{ fontWeight: 1200 }}>{r.title}</div>
                </div>
                <div style={{ marginTop: 8, color: "#111", fontWeight: 1000 }}>{r.body}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
