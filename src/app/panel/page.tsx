"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { QuickLink } from "@/components/ui/QuickLink";

function fmt(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES");
}
function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function medal(pos: number) {
  return pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "";
}

type RankKey = "minutes" | "repite_pct" | "cliente_pct" | "captadas";

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
  };

  myEarnings: null | {
    minutes_total: number;
    captadas: number;
    amount_base_eur: number;
    amount_bonus_eur: number;
    amount_total_eur: number;
  };

  // ✅ NUEVO
  teamsRanking?: Array<{
    team_id: string;
    team_name: string;
    total_eur_month: number;
    total_minutes: number;
    total_captadas: number;
    member_count: number;
  }>;

  myTeamRank?: number | null;

  winnerTeam: null | {
    team_id: string;
    team_name: string;
    central_user_id?: string | null;
    central_name: string | null;
    total_minutes: number;
    total_captadas: number;
    total_eur_month?: number;
  };

  bonusRules: Array<{
    ranking_type: string;
    position: number;
    role: string;
    amount_eur: number;
  }>;
};

type PresenceState = "offline" | "online" | "pause" | "bathroom";

function labelRanking(k: string) {
  const key = String(k || "").toLowerCase();
  if (key === "captadas") return "Captadas";
  if (key === "cliente_pct") return "Clientes %";
  if (key === "repite_pct") return "Repite %";
  if (key === "minutes") return "Minutos";
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
  const [y, m] = isoMonthDate.split("-");
  const monthNum = Number(m);
  const yearNum = Number(y);
  if (!monthNum || !yearNum) return isoMonthDate;

  const date = new Date(yearNum, monthNum - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

export default function PanelPage() {
  const router = useRouter();

  const [rankType, setRankType] = useState<RankKey>("minutes");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [data, setData] = useState<DashboardResp | null>(null);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // Presencia (persistente)
  const [pState, setPState] = useState<PresenceState>("offline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  // Crono
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<any>(null);

  const isLogged = pState !== "offline";

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
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) return;

      setPState((j.state as PresenceState) || "offline");
      setSessionId(j.session_id || null);
      setStartedAt(j.started_at || null);
    } catch {
      // no rompemos el panel
    }
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
      });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "Error logout presencia");

      await loadPresence();
    } catch (e: any) {
      setErr(e?.message || "Error logout presencia");
    }
  }

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const ranks = data?.rankings?.[rankType] || [];

  const myRankTarot = useMemo(() => {
    const myName = me?.display_name;
    if (!myName) return null;
    const idx = ranks.findIndex((x: any) => x.name === myName);
    return idx === -1 ? null : idx + 1;
  }, [me?.display_name, ranks]);

  const myRank = myRole === "central" ? (data?.myTeamRank ?? null) : myRankTarot;

  function top3For(k: RankKey) {
    const list = data?.rankings?.[k] || [];
    return list.slice(0, 3);
  }

  function valueOf(k: RankKey, r: any) {
    if (k === "minutes") return fmt(r.minutes);
    if (k === "captadas") return fmt(r.captadas);
    if (k === "repite_pct") return `${r.repite_pct} %`;
    if (k === "cliente_pct") return `${r.cliente_pct} %`;
    return "";
  }

  const stateTone = pState === "online" ? "ok" : pState === "pause" || pState === "bathroom" ? "warn" : "neutral";
  const stateText =
    pState === "online" ? "ONLINE" : pState === "pause" ? "PAUSA" : pState === "bathroom" ? "BAÑO" : "OFFLINE";

  const totalEur = data?.myEarnings?.amount_total_eur ?? null;
  const minutesTotal = data?.myEarnings?.minutes_total ?? null;
  const captadasTotal = data?.myEarnings?.captadas ?? null;

  const months = data?.months || [];
  const monthLabel = selectedMonth
    ? formatMonthLabel(selectedMonth)
    : data?.month_date
      ? formatMonthLabel(data.month_date)
      : "—";

  const teams = data?.teamsRanking || [];
  const team1 = teams[0] || null;
  const team2 = teams[1] || null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Título + acciones */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Panel</h1>

        {/* Selector de mes */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#666", fontWeight: 800 }}>Mes:</span>

          <select
            value={selectedMonth || data?.month_date || ""}
            onChange={(e) => setSelectedMonth(e.target.value || null)}
            style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd", minWidth: 220 }}
            disabled={loading || months.length === 0}
            title={months.length === 0 ? "No hay meses disponibles" : "Selecciona mes"}
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

          <span style={{ color: "#666" }}>
            <b>{monthLabel}</b>
          </span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => load(selectedMonth)}
            disabled={loading}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
          >
            {loading ? "Actualizando..." : "Actualizar"}
          </button>
          {/* ✅ Quitado el 2º logout: se queda el de cabecera */}
        </div>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10 }}>{err}</div>
      ) : null}

      {/* ✅ NUEVO: MARCADOR POR EQUIPOS (Central) */}
      {myRole === "central" && teams.length > 0 ? (
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 16,
            padding: 14,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 1000, fontSize: 18, marginBottom: 10 }}>🏆 Ranking por equipos (mes)</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "stretch" }}>
            <div style={{ border: "1px solid #f0f0f0", borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 1000, fontSize: 16 }}>
                {team1 ? `#1 ${team1.team_name}` : "—"}
              </div>
              <div style={{ fontSize: 28, fontWeight: 1100, marginTop: 6 }}>
                {team1 ? eur(team1.total_eur_month) : "—"}
              </div>
              <div style={{ color: "#666", marginTop: 6 }}>
                Minutos: <b>{team1 ? fmt(team1.total_minutes) : "—"}</b> · Captadas:{" "}
                <b>{team1 ? fmt(team1.total_captadas) : "—"}</b>
              </div>
            </div>

            <div style={{ display: "grid", placeItems: "center", padding: 6 }}>
              <div style={{ fontWeight: 1000, color: "#666" }}>VS</div>
            </div>

            <div style={{ border: "1px solid #f0f0f0", borderRadius: 14, padding: 12 }}>
              <div style={{ fontWeight: 1000, fontSize: 16 }}>
                {team2 ? `#2 ${team2.team_name}` : "—"}
              </div>
              <div style={{ fontSize: 28, fontWeight: 1100, marginTop: 6 }}>
                {team2 ? eur(team2.total_eur_month) : "—"}
              </div>
              <div style={{ color: "#666", marginTop: 6 }}>
                Minutos: <b>{team2 ? fmt(team2.total_minutes) : "—"}</b> · Captadas:{" "}
                <b>{team2 ? fmt(team2.total_captadas) : "—"}</b>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, color: "#666" }}>
            Tu equipo va: <b>{data?.myTeamRank ? `${medal(data.myTeamRank)} #${data.myTeamRank}` : "—"}</b>
          </div>
        </div>
      ) : null}

      {/* Cards arriba */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
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
          <CardTitle>Total € este mes</CardTitle>
          <CardValue>{totalEur === null ? "—" : eur(totalEur)}</CardValue>
          <CardHint>
            Minutos: <b>{minutesTotal === null ? "—" : fmt(minutesTotal)}</b> · Captadas:{" "}
            <b>{captadasTotal === null ? "—" : fmt(captadasTotal)}</b>
          </CardHint>
        </Card>

        <Card>
          <CardTitle>Mi posición (ranking actual)</CardTitle>
          <CardValue>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</CardValue>
          <CardHint>{myRole === "central" ? "Según ranking de equipos." : "Según el ranking seleccionado abajo."}</CardHint>
        </Card>
      </div>

      {/* Accesos rápidos: solo Admin (quitados Mis facturas / Panel duplicados) */}
      {data?.user?.isAdmin ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <QuickLink href="/admin" title="Ir a Admin" desc="Presencia, incidencias, trabajadores y más." />
        </div>
      ) : null}

      {/* ✅ Control horario (en el siguiente paso lo haremos aún más pro, aquí ya queda bien) */}
      {me?.role === "tarotista" || me?.role === "central" ? (
        <Card>
          <CardTitle>Control horario</CardTitle>
          <CardHint>
            Usuario: <b>{me?.display_name || "—"}</b> · Rol: <b>{labelRole(me?.role || "—")}</b> · Mes:{" "}
            <b>{selectedMonth || data?.month_date || "—"}</b>
          </CardHint>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <button
              onClick={presenceLogin}
              disabled={isLogged}
              style={{ padding: 10, borderRadius: 12, border: "1px solid #111", fontWeight: 900, opacity: isLogged ? 0.5 : 1 }}
            >
              Loguear
            </button>

            <button
              onClick={() => presenceSet("pause")}
              disabled={!isLogged}
              style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", fontWeight: 900, opacity: !isLogged ? 0.5 : 1 }}
            >
              Pausa
            </button>

            <button
              onClick={() => presenceSet("bathroom")}
              disabled={!isLogged}
              style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", fontWeight: 900, opacity: !isLogged ? 0.5 : 1 }}
            >
              Baño
            </button>

            <button
              onClick={() => presenceSet("online")}
              disabled={!isLogged}
              style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", fontWeight: 900, opacity: !isLogged ? 0.5 : 1 }}
            >
              Volver (Online)
            </button>

            <button
              onClick={presenceLogout}
              disabled={!isLogged}
              style={{
                padding: 10,
                borderRadius: 12,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 900,
                opacity: !isLogged ? 0.5 : 1,
              }}
            >
              Desloguear
            </button>

            <button onClick={loadPresence} style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", fontWeight: 900 }}>
              Refrescar estado
            </button>
          </div>
        </Card>
      ) : null}

      {/* Top 3 */}
      <Card>
        <CardTitle>Top 3 del mes</CardTitle>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 10 }}>
          {(["minutes", "repite_pct", "cliente_pct", "captadas"] as RankKey[]).map((k) => (
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

      {/* Rankings */}
      <Card>
        <CardTitle>Rankings (tabla completa)</CardTitle>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={rankType} onChange={(e) => setRankType(e.target.value as RankKey)} style={{ padding: 8 }}>
            <option value="minutes">Ranking por Minutos</option>
            <option value="repite_pct">Ranking por Repite %</option>
            <option value="cliente_pct">Ranking por Clientes %</option>
            <option value="captadas">Ranking por Captadas</option>
          </select>

          <div style={{ color: "#666" }}>
            Mi posición: <b>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</b>
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
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
                const value =
                  rankType === "minutes"
                    ? fmt(r.minutes)
                    : rankType === "captadas"
                      ? fmt(r.captadas)
                      : rankType === "repite_pct"
                        ? `${r.repite_pct} %`
                        : rankType === "cliente_pct"
                          ? `${r.cliente_pct} %`
                          : "";

                return (
                  <tr key={r.worker_id} style={{ background: isMe ? "#e8f4ff" : "transparent", fontWeight: isMe ? 900 : 400 }}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      {medal(pos)} {pos}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{value}</td>
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
