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

  // en tu API actual esto existe (aunque sea 0 si no hay fila)
  myEarnings: null | {
    minutes_total: number;
    captadas: number;
    amount_base_eur: number;
    amount_bonus_eur: number;
    amount_total_eur: number;
  };

  myIncidentsMonth?: { count: number; penalty_eur: number; grave: boolean };

  // (no existe aún en tu endpoint; el panel hace fallback)
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
  // “día de trabajo”: si son < 05:00, cuenta como el día anterior
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
        // seguridad: si entra alguien que no es central, lo mandamos a /panel
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
    // 1) carga datos
    loadDashboard(null);
    // 2) presencia
    loadPresence();

    // 3) checklist (storage)
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
    // recarga si cambia mes
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

  const teams = data?.teamsRanking || [];
  const hasTeams = Array.isArray(teams) && teams.length >= 2;

  // Recomendaciones “inteligentes” usando rankings actuales
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
      out.push({
        tone: "ok",
        title: "Captación fuerte",
        body: `${topCap.name} está captando mucho últimamente. Si está disponible, pásale más llamadas para aprovechar el momento.`,
      });
    }
    if (topCli?.name) {
      out.push({
        tone: "ok",
        title: "Clientes nuevos (muy bien)",
        body: `${topCli.name} tiene un %Clientes muy alto. Ideal para primeras consultas y picos de demanda.`,
      });
    }
    if (topRep?.name) {
      out.push({
        tone: "ok",
        title: "Fidelización excelente",
        body: `${topRep.name} está fidelizando muy bien (%Repite). Si quieres mejorar repetición, priorízale llamadas de seguimiento.`,
      });
    }
    if (lowCli?.name) {
      out.push({
        tone: "warn",
        title: "Ojo con %Clientes",
        body: `${lowCli.name} está baja en %Clientes. Revisa si necesita más llamadas de primera consulta o ajustar el enfoque.`,
      });
    }
    if (lowRep?.name) {
      out.push({
        tone: "warn",
        title: "Ojo con %Repite",
        body: `${lowRep.name} está baja en %Repite. Quizá conviene reforzar cierres y seguimiento.`,
      });
    }

    // variación para que no sea siempre lo mismo
    const shuffled = [...out].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
  }, [data?.rankings?.captadas, data?.rankings?.cliente_pct, data?.rankings?.repite_pct]);

  const bonusEstimate = useMemo(() => {
    // En tu API actual myEarnings.amount_bonus_eur viene de invoice.bonuses_eur del worker.
    // Pero tú has dicho: “en central por ahora solo bono por equipo ganador”.
    // Como aún no tenemos teams + winner + rule, hacemos:
    // - si backend ya mete amount_bonus_eur, lo mostramos
    // - si no, 0 y texto “pendiente de reglas team_winner”.
    const v = data?.myEarnings?.amount_bonus_eur;
    return typeof v === "number" ? v : 0;
  }, [data?.myEarnings?.amount_bonus_eur]);

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

      // ⚠️ endpoint placeholder: necesito que me digas cuál es el endpoint real de creación
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

      // refresca dashboard por si el endpoint actualiza algo
      await loadDashboard(selectedMonth);
    } catch (e: any) {
      setIncStatus("err");
      setIncMsg(e?.message || "Error creando incidencia");
    }
  }

  // Tabs simples (sin tocar layout)
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

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1100 }}>
      {/* Header compact (sin duplicar layout) */}
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
          {/* Equipos (fallback pro) */}
          <div style={{ ...shellCard, padding: 14, border: "1px solid #111" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 1300, fontSize: 18 }}>🏆 Equipos (GLOBAL)</div>
              <div style={{ color: "#6b7280", fontWeight: 1000 }}>
                Score basado en <b>%Clientes + %Repite</b>
              </div>
            </div>

            {!hasTeams ? (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 16, border: "1px solid #e5e7eb", background: "#fff" }}>
                <div style={{ fontWeight: 1200 }}>Falta el ranking de equipos</div>
                <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 1000 }}>
                  Tu endpoint <b>/api/dashboard/full</b> aún no devuelve <b>teamsRanking / myTeamRank / winnerTeam / bonusRules</b>.
                  <br />
                  En el siguiente paso lo añadimos sin tocar facturación.
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 12, color: "#6b7280", fontWeight: 1000 }}>OK (cuando tengamos teamsRanking lo renderizamos aquí).</div>
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
              <CardTitle>Bono estimado</CardTitle>
              <CardValue>{eur(bonusEstimate)}</CardValue>
              <CardHint>Por ahora: bono de equipo (cuando activemos team_winner).</CardHint>
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

          {/* Checklist diario */}
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
          {/* Incidencias: crear desde central (UI lista, endpoint a confirmar) */}
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
                <button
                  onClick={submitIncident}
                  disabled={!incName.trim()}
                  style={!incName.trim() ? { ...btnPrimary, opacity: 0.5, cursor: "not-allowed" } : btnPrimary}
                >
                  Registrar
                </button>

                <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>
                  Nota: este botón llama a <b>/api/incidents/create</b>. Si tu endpoint tiene otro nombre, dímelo y lo conecto.
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
