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

  // si tu /api/dashboard/full ya lo devuelve (por el layout), perfecto
  myTeam?: { team_id: string; team_name: string } | null;

  // opcional extra (si lo tienes)
  teamYami?: any;
  teamMaria?: any;
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

type ChecklistItem = { id: string; label: string; hint?: string };

const CHECKLIST: ChecklistItem[] = [
  { id: "login", label: "Loguearse y abrir panel", hint: "Entrar (presencia) y comprobar que todo carga." },
  { id: "greet", label: "Saludar a las tarotistas", hint: "Mensaje breve de inicio de turno." },
  { id: "check_logins", label: "Comprobar logueos", hint: "Ver quién está online / quién falta." },
  { id: "ask_clients", label: "Pedir lista de clientes", hint: "Asegurar captación/colas preparadas." },
  { id: "check_incidents", label: "Comprobar incidencias", hint: "Revisar ausencias/retrasos y registrar." },
];

type Recommendation = { tone: "ok" | "warn"; title: string; body: string };

// ✅ helper: buscar bono “team winner” dentro de bonus_rules si existe (si no, fallback 40€)
function getTeamWinnerBonus(bonusRules: any[] | undefined | null) {
  const fallback = 40;

  const rules = Array.isArray(bonusRules) ? bonusRules : [];
  if (!rules.length) return fallback;

  // intentamos encontrar una regla activa para ganador de equipo
  // (no asumimos esquema exacto; buscamos por texto)
  const pick = rules
    .filter((r) => r && (r.is_active === true || r.is_active == null))
    .map((r) => {
      const rt = String(r.ranking_type || "").toLowerCase();
      const role = String(r.role || "").toLowerCase();
      const pos = Number(r.position ?? 0);
      const amount = Number(r.amount_eur ?? r.amount ?? 0);
      const created = String(r.created_at || "");
      return { rt, role, pos, amount, created };
    })
    .filter((r) => Number.isFinite(r.amount) && r.amount > 0)
    .filter((r) => r.rt.includes("team") && (r.rt.includes("winner") || r.rt.includes("ganador") || r.rt.includes("equipo")))
    // si vienen con position, queremos el #1
    .sort((a, b) => {
      const pa = a.pos || 999;
      const pb = b.pos || 999;
      if (pa !== pb) return pa - pb;
      return String(b.created).localeCompare(String(a.created));
    })[0];

  return pick?.amount ? pick.amount : fallback;
}

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

  const [incName, setIncName] = useState("");
  const [incKind, setIncKind] = useState<"late" | "absence" | "other">("late");
  const [incNotes, setIncNotes] = useState("");
  const [incStatus, setIncStatus] = useState<null | "ok" | "err">(null);
  const [incMsg, setIncMsg] = useState<string>("");

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

  // ✅ BONO EN VIVO: si el equipo del central va #1 ahora mismo
  const bonusEstimate = useMemo(() => {
    const bonus = getTeamWinnerBonus(data?.bonusRules);

    const teams = Array.isArray(data?.teamsRanking) ? data!.teamsRanking! : [];
    const winnerId = String(data?.winnerTeam?.team_id || "");

    if (!winnerId) return 0;

    // 1) si el backend devuelve myTeam (a veces no para central), úsalo
    let myTeamId = String(data?.myTeam?.team_id || "");

    // 2) si no hay myTeamId, lo deducimos por nombre del central:
    //    “Yami” => “Equipo Yami”
    if (!myTeamId && me?.display_name && teams.length) {
      const meName = String(me.display_name || "").toLowerCase();
      const found = teams.find((t: any) => String(t?.team_name || "").toLowerCase().includes(meName));
      if (found?.team_id) myTeamId = String(found.team_id);
    }

    // si no podemos deducir equipo, no inventamos
    if (!myTeamId) return 0;

    return myTeamId === winnerId ? bonus : 0;
  }, [data?.bonusRules, data?.winnerTeam, data?.teamsRanking, data?.myTeam, me?.display_name]);

  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;

  const bigActionLabel = pState === "offline" ? "Entrar" : "Salir";
  const bigActionFn = pState === "offline" ? presenceLogin : presenceLogout;

  async function submitIncident() {
    setIncStatus(null);
    setIncMsg("");
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/incidents/create", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          target_name: incName.trim(),
          kind: incKind,
          notes: incNotes.trim(),
        }),
      });

      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        setIncStatus("err");
        setIncMsg(j?.error || `No se pudo crear (status ${res.status})`);
        return;
      }

      setIncStatus("ok");
      setIncMsg("Incidencia registrada ✅");
      setIncName("");
      setIncNotes("");

      await loadDashboard(selectedMonth);
    } catch (e: any) {
      setIncStatus("err");
      setIncMsg(e?.message || "Error creando incidencia");
    }
  }

  const tabBar: React.CSSProperties = {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
  };

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

  // Recomendaciones “inteligentes”
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

    if (topCap?.name) {
      out.push({ tone: "ok", title: "Captación fuerte", body: `${topCap.name} está captando mucho últimamente. Si está disponible, pásale más llamadas para aprovechar el momento.` });
    }
    if (topCli?.name) {
      out.push({ tone: "ok", title: "Clientes nuevos (muy bien)", body: `${topCli.name} tiene un %Clientes muy alto. Ideal para primeras consultas y picos de demanda.` });
    }
    if (topRep?.name) {
      out.push({ tone: "ok", title: "Fidelización excelente", body: `${topRep.name} está fidelizando muy bien (%Repite). Si quieres mejorar repetición, priorízale llamadas de seguimiento.` });
    }
    if (lowCli?.name) {
      out.push({ tone: "warn", title: "Ojo con %Clientes", body: `${lowCli.name} está baja en %Clientes. Revisa si necesita más llamadas de primera consulta o ajustar el enfoque.` });
    }
    if (lowRep?.name) {
      out.push({ tone: "warn", title: "Ojo con %Repite", body: `${lowRep.name} está baja en %Repite. Quizá conviene reforzar cierres y seguimiento.` });
    }

    return [...out].sort(() => Math.random() - 0.5).slice(0, 4);
  }, [data?.rankings?.captadas, data?.rankings?.cliente_pct, data?.rankings?.repite_pct]);

  const teams = data?.teamsRanking || [];
  const hasTeams = Array.isArray(teams) && teams.length >= 2;

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1100 }}>
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
          <div style={{ ...shellCard, padding: 14, border: "1px solid #111" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1300, fontSize: 18 }}>🏆 Equipos (GLOBAL)</div>
              <div style={{ color: "#6b7280", fontWeight: 1000 }}>
                Score basado en <b>%Clientes + %Repite</b>
              </div>
            </div>

            {!hasTeams ? (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 16, border: "1px solid #e5e7eb", background: "#fff" }}>
                <div style={{ fontWeight: 1200 }}>Sin datos de equipos para este mes.</div>
              </div>
            ) : null}
          </div>

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
              <CardHint>Se calcula al momento: si tu equipo va 1º ahora mismo.</CardHint>
            </Card>

            <Card>
              <CardTitle>Incidencias (mes)</CardTitle>
              <CardValue>{incCount == null ? "—" : fmt(incCount)}</CardValue>
              <CardHint>
                Penalización: <b>{incPenalty == null ? "—" : eur(incPenalty)}</b>
              </CardHint>
            </Card>
          </div>

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

          <div style={{ ...shellCard, padding: 14 }}>
            <div style={{ fontWeight: 1400, fontSize: 18 }}>💡 Recomendaciones</div>
            <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 1000 }}>
              Generadas automáticamente según rankings del mes.
            </div>

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
          <div style={{ ...shellCard, padding: 14 }}>
            <div style={{ fontWeight: 1400, fontSize: 18 }}>🧾 Registrar incidencia a tarotista</div>
            <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>
              Marca cuando una tarotista no conecta a la hora u otras incidencias.
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 220px", gap: 12 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Tarotista (nombre)</div>
                  <input
                    value={incName}
                    onChange={(e) => setIncName(e.target.value)}
                    placeholder="Ej: Carmelina"
                    style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 1100 }}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Tipo</div>
                  <select
                    value={incKind}
                    onChange={(e) => setIncKind(e.target.value as any)}
                    style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 1100 }}
                  >
                    <option value="late">Retraso / No conecta</option>
                    <option value="absence">Ausencia</option>
                    <option value="other">Otro</option>
                  </select>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Notas</div>
                  <textarea
                    value={incNotes}
                    onChange={(e) => setIncNotes(e.target.value)}
                    placeholder="Detalles (hora, qué pasó, etc.)"
                    rows={4}
                    style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 1000, resize: "vertical" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                <button onClick={submitIncident} disabled={!incName.trim()} style={!incName.trim() ? { ...btnPrimary, opacity: 0.5, cursor: "not-allowed" } : btnPrimary}>
                  Registrar
                </button>

                <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>
                  Nota: este botón llama a <b>/api/incidents/create</b>.
                </div>

                {incStatus ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: incStatus === "ok" ? "1px solid #d1fae5" : "1px solid #ffcccc",
                      background: "#fff",
                      fontWeight: 1100,
                      color: incStatus === "ok" ? "#065f46" : "#991b1b",
                    }}
                  >
                    {incMsg}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
