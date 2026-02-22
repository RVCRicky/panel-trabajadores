// src/app/panel/central/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

type PresenceState = "offline" | "online" | "pause" | "bathroom";

type TeamMember = { worker_id: string; name: string; role: string };
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

  teamsRanking?: TeamRow[];
  myTeamRank?: number | null;
  myTeam?: { team_id: string; team_name: string } | null;
  winnerTeam?: any;
  bonusRules?: any[];

  // ✅ nuevos
  teamYami?: TeamRow | null;
  teamMaria?: TeamRow | null;
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
function formatMonthLabel(isoMonthDate: string) {
  const [y, m] = String(isoMonthDate || "").split("-");
  const monthNum = Number(m);
  const yearNum = Number(y);
  if (!monthNum || !yearNum) return isoMonthDate;
  const date = new Date(yearNum, monthNum - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

// ✅ Reset diario a las 05:00 (Europe/Madrid) en localStorage
function dailyKeyAt5(prefix: string) {
  const now = new Date();
  const d = new Date(now);
  const h = d.getHours();
  if (h < 5) d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${prefix}:${y}-${m}-${day}`;
}

type ChecklistItem = {
  id: string;
  label: string;
  hint?: string;
};

const CHECKLIST: ChecklistItem[] = [
  { id: "login", label: "Loguearse y abrir panel", hint: "Entrar (presencia) y comprobar que todo carga." },
  { id: "greet", label: "Saludar a las tarotistas", hint: "Mensaje breve de inicio de turno." },
  { id: "check_logins", label: "Comprobar logueos", hint: "Ver quién está online / quién falta." },
  { id: "ask_clients", label: "Pedir lista de clientes", hint: "Asegurar captación/colas preparadas." },
  { id: "check_incidents", label: "Comprobar incidencias", hint: "Revisar ausencias/retrasos y registrar." },
];

type Recommendation = { tone: "ok" | "warn"; title: string; body: string };

export default function CentralPanelPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [data, setData] = useState<DashboardResp | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const [pState, setPState] = useState<PresenceState>("offline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<any>(null);

  const [checkState, setCheckState] = useState<Record<string, boolean>>({});
  const checklistKey = useMemo(() => dailyKeyAt5("tc_central_checklist"), []);

  const isLogged = pState !== "offline";

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function loadDashboard(monthOverride?: string | null) {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

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

      const role = String(j?.user?.worker?.role || "").toLowerCase();
      if (role !== "central") {
        router.replace("/panel");
        return;
      }

      setData(j);
      if (j.month_date && j.month_date !== selectedMonth) setSelectedMonth(j.month_date);
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
    loadDashboard(null);
    loadPresence();

    try {
      const raw = localStorage.getItem(checklistKey);
      if (raw) setCheckState(JSON.parse(raw));
      else setCheckState({});
    } catch {
      setCheckState({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    if (!data) return;
    if (data.month_date === selectedMonth) return;
    loadDashboard(selectedMonth);
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

  function persistChecklist(next: Record<string, boolean>) {
    setCheckState(next);
    try {
      localStorage.setItem(checklistKey, JSON.stringify(next));
    } catch {}
  }

  const me = data?.user?.worker || null;
  const months = data?.months || [];
  const monthLabel = selectedMonth ? formatMonthLabel(selectedMonth) : data?.month_date ? formatMonthLabel(data.month_date) : "—";

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

  const teams = (data?.teamsRanking || []) as TeamRow[];
  const hasTeams = Array.isArray(teams) && teams.length >= 1;

  const teamBox = (t: TeamRow | null | undefined, fallbackTitle: string) => {
    const tarotists = (t?.members || []).filter((m) => String(m.role || "").toLowerCase() === "tarotista");
    return (
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 1400, fontSize: 16 }}>{t?.team_name || fallbackTitle}</div>
          <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>{t?.team_id ? t.team_id : "—"}</div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 10, background: "#fff" }}>
            <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Score</div>
            <div style={{ fontWeight: 1500, fontSize: 18 }}>{t?.team_score ?? "—"}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 10, background: "#fff" }}>
            <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Tarotistas</div>
            <div style={{ fontWeight: 1500, fontSize: 18 }}>{tarotists.length}</div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12, marginBottom: 6 }}>Lista tarotistas</div>
          {tarotists.length === 0 ? (
            <div style={{ padding: 10, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", color: "#6b7280", fontWeight: 1000 }}>
              No hay tarotistas en este equipo (o faltan members).
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {tarotists.map((m) => (
                <span
                  key={m.worker_id}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 999,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    fontWeight: 1100,
                  }}
                  title={m.worker_id}
                >
                  {m.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // recomendaciones (igual que antes)
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

    if (topCap?.name) out.push({ tone: "ok", title: "Captación fuerte", body: `${topCap.name} está captando mucho últimamente. Si está disponible, pásale más llamadas para aprovechar el momento.` });
    if (topCli?.name) out.push({ tone: "ok", title: "Clientes nuevos (muy bien)", body: `${topCli.name} tiene un %Clientes muy alto. Ideal para primeras consultas y picos de demanda.` });
    if (topRep?.name) out.push({ tone: "ok", title: "Fidelización excelente", body: `${topRep.name} está fidelizando muy bien (%Repite). Si quieres mejorar repetición, priorízale llamadas de seguimiento.` });
    if (lowCli?.name) out.push({ tone: "warn", title: "Ojo con %Clientes", body: `${lowCli.name} está baja en %Clientes. Revisa si necesita más llamadas de primera consulta o ajustar el enfoque.` });
    if (lowRep?.name) out.push({ tone: "warn", title: "Ojo con %Repite", body: `${lowRep.name} está baja en %Repite. Quizá conviene reforzar cierres y seguimiento.` });

    return out.sort(() => Math.random() - 0.5).slice(0, 4);
  }, [data?.rankings?.captadas, data?.rankings?.cliente_pct, data?.rankings?.repite_pct]);

  const bonusEstimate = useMemo(() => {
    const v = data?.myEarnings?.amount_bonus_eur;
    return typeof v === "number" ? v : 0;
  }, [data?.myEarnings?.amount_bonus_eur]);

  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;

  const bigActionLabel = pState === "offline" ? "Entrar" : "Salir";
  const bigActionFn = pState === "offline" ? presenceLogin : presenceLogout;

  // Tabs
  const tabBar: React.CSSProperties = { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" };
  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: "10px 12px",
    borderRadius: 999,
    border: active ? "1px solid #111" : "1px solid #e5e7eb",
    background: active ? "#111" : "#fff",
    color: active ? "#fff" : "#111",
    fontWeight: 1100,
    cursor: "pointer",
  });
  const [tab, setTab] = useState<"dashboard" | "incidents">("dashboard");

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", gap: 12, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1400, fontSize: 18, lineHeight: 1 }}>Central</div>
              <Badge tone={stateTone as any}>{stateText}</Badge>
              <div style={{ fontWeight: 1400 }}>{formatHMS(elapsedSec)}</div>

              {me?.display_name ? (
                <div style={{ color: "#6b7280", fontWeight: 900 }}>
                  {me.display_name} · Central
                </div>
              ) : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "420px 1fr", gap: 10, alignItems: "end" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Mes</div>
                <select
                  value={selectedMonth || data?.month_date || ""}
                  onChange={(e) => setSelectedMonth(e.target.value || null)}
                  style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 1100, width: "100%" }}
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

              {!isMobile ? <div style={{ color: "#6b7280", fontWeight: 1100, textTransform: "capitalize" }}>{monthLabel}</div> : null}
            </div>

            <div style={tabBar}>
              <button onClick={() => setTab("dashboard")} style={tabBtn(tab === "dashboard")}>
                Dashboard
              </button>
              <button onClick={() => setTab("incidents")} style={tabBtn(tab === "incidents")}>
                Incidencias
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, justifyItems: isMobile ? "stretch" : "end" }}>
            <button onClick={() => loadDashboard(selectedMonth)} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}>
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

      {tab === "dashboard" ? (
        <>
          {/* ✅ Equipos global (YA con stats reales) */}
          <div style={{ ...shellCard, padding: 14, border: "1px solid #111" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1300, fontSize: 18 }}>🏆 Equipos (GLOBAL)</div>
              <div style={{ color: "#6b7280", fontWeight: 1000 }}>
                Score = <b>%Clientes + %Repite</b>
                {data?.myTeamRank ? (
                  <>
                    {" "}
                    · Tu equipo: <b>#{data.myTeamRank}</b>
                  </>
                ) : null}
              </div>
            </div>

            {!hasTeams ? (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 16, border: "1px solid #e5e7eb", background: "#fff" }}>
                <div style={{ fontWeight: 1200 }}>Sin datos de equipos para este mes</div>
                <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>
                  Ahora el backend calcula desde <b>team_members + monthly_rankings + worker_invoices</b>. Si sigue vacío, es que faltan miembros en <b>team_members</b> o el mes no tiene datos en rankings.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" }}>#</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" }}>Equipo</th>
                      <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #e5e7eb" }}>Score</th>
                      <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #e5e7eb" }}>Minutos</th>
                      <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #e5e7eb" }}>Captadas</th>
                      <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #e5e7eb" }}>€ Mes</th>
                      <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #e5e7eb" }}>Miembros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((t, idx) => (
                      <tr key={t.team_id}>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontWeight: 1200 }}>{medal(idx + 1) || idx + 1}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontWeight: 1200 }}>{t.team_name}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: 1200 }}>{t.team_score ?? 0}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{fmt(t.total_minutes)}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{fmt(t.total_captadas)}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{eur(t.total_eur_month)}</td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{fmt(t.member_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {data?.winnerTeam ? (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 16, border: "1px solid #d1fae5", background: "#fff" }}>
                    <div style={{ fontWeight: 1300 }}>🏅 Ganador del mes: {data.winnerTeam.team_name}</div>
                    <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>
                      Score: <b>{data.winnerTeam.team_score}</b> · Minutos: <b>{fmt(data.winnerTeam.total_minutes)}</b> · Captadas: <b>{fmt(data.winnerTeam.total_captadas)}</b>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* ✅ Equipo Yami + Maria con lista */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
            {teamBox(data?.teamYami || null, "Equipo Yami")}
            {teamBox(data?.teamMaria || null, "Equipo Maria")}
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
              <CardTitle>Bono estimado</CardTitle>
              <CardValue>{eur(bonusEstimate)}</CardValue>
              <CardHint>Por ahora: bono de equipo (team_winner).</CardHint>
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
                <div style={{ color: "#6b7280", fontWeight: 1000, marginTop: 4 }}>
                  {pState === "offline" ? "Pulsa “Entrar” para iniciar tu turno." : "Gestiona tu estado durante el turno."}
                </div>
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

          {/* Checklist diario (NO TOCADO) */}
          <div style={{ ...shellCard, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <div style={{ fontWeight: 1400, fontSize: 18 }}>✅ Checklist diario</div>
              <div style={{ color: "#6b7280", fontWeight: 1000 }}>
                Se reinicia a las <b>05:00</b> (hora España).
              </div>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {CHECKLIST.map((it) => {
                const on = !!checkState[it.id];
                return (
                  <div
                    key={it.id}
                    style={{
                      border: on ? "2px solid #111" : "1px solid #e5e7eb",
                      borderRadius: 16,
                      padding: 12,
                      background: "#fff",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 1200 }}>{it.label}</div>
                      {it.hint ? <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>{it.hint}</div> : null}
                    </div>

                    <button
                      onClick={() => {
                        const next = { ...checkState, [it.id]: !on };
                        persistChecklist(next);
                      }}
                      style={on ? btnPrimary : btnGhost}
                    >
                      {on ? "Hecho" : "Marcar"}
                    </button>
                  </div>
                );
              })}
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
                  <div
                    key={idx}
                    style={{
                      padding: 12,
                      borderRadius: 16,
                      border: r.tone === "warn" ? "1px solid #fed7aa" : "1px solid #d1fae5",
                      background: "#fff",
                    }}
                  >
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
        </>
      ) : (
        <>
          {/* Incidencias: si ya lo tienes conectado en otro endpoint, lo conectamos después */}
          <div style={{ ...shellCard, padding: 14 }}>
            <div style={{ fontWeight: 1400, fontSize: 18 }}>🧾 Incidencias</div>
            <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>Este tab lo dejamos como lo tenías. (Si quieres, conectamos aquí el endpoint real.)</div>
          </div>
        </>
      )}
    </div>
  );
}
