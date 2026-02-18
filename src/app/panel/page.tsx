"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type RankKey = "minutes" | "repite_pct" | "cliente_pct" | "captadas";

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

  winnerTeam: null | {
    team_id: string;
    team_name: string;
    central_user_id?: string | null;
    central_name: string | null;
    total_minutes: number;
    total_captadas: number;
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
  if (key === "team_win") return "Equipo ganador (central)";
  if (key === "captadas_steps") return "Captadas por tramos (sin límite)";
  if (key === "improve_repite") return "Mejora Repite % vs mes anterior";
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

function pill(state: PresenceState) {
  const base: any = {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 900,
    border: "1px solid #ddd",
    fontSize: 12,
  };
  if (state === "online") return <span style={{ ...base, background: "#eaffea" }}>ONLINE</span>;
  if (state === "pause") return <span style={{ ...base, background: "#fff6dd" }}>PAUSA</span>;
  if (state === "bathroom") return <span style={{ ...base, background: "#e8f4ff" }}>BAÑO</span>;
  return <span style={{ ...base, background: "#f4f4f4" }}>OFFLINE</span>;
}

export default function PanelPage() {
  const router = useRouter();

  const [rankType, setRankType] = useState<RankKey>("minutes");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardResp | null>(null);

  // Presencia (persistente)
  const [pState, setPState] = useState<PresenceState>("offline");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  // Cronómetro
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<any>(null);

  // Admin: pendientes (incidencias)
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  const isLogged = pState !== "offline";

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  // ✅ Presencia REAL desde backend
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

  async function loadAdminPending() {
    try {
      // solo si eres admin (si no, ni lo intentes)
      if (!data?.user?.isAdmin) return;

      const token = await getToken();
      if (!token) return;

      const res = await fetch("/api/admin/incidents/pending", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setPendingCount(null);
        return;
      }

      // soporta varios formatos (count / rows.length)
      const c =
        typeof j.count === "number"
          ? j.count
          : Array.isArray(j.rows)
          ? j.rows.length
          : Array.isArray(j.items)
          ? j.items.length
          : null;

      setPendingCount(c);
    } catch {
      setPendingCount(null);
    }
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

      // presencia solo para central/tarotista
      const role = j?.user?.worker?.role || null;
      if (role === "tarotista" || role === "central") {
        await loadPresence();
      }

      // admin pendientes
      if (j?.user?.isAdmin) {
        await loadAdminPending();
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cronómetro
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);

    if (!startedAt || pState === "offline") {
      setElapsedSec(0);
      return;
    }

    const startMs = new Date(startedAt).getTime();
    const update = () => {
      const now = Date.now();
      setElapsedSec(Math.max(0, Math.floor((now - startMs) / 1000)));
    };
    update();

    tickRef.current = setInterval(update, 1000);
    return () => tickRef.current && clearInterval(tickRef.current);
  }, [startedAt, pState]);

  const me = data?.user?.worker || null;
  const ranks = data?.rankings?.[rankType] || [];

  const myRank = useMemo(() => {
    const myName = me?.display_name;
    if (!myName) return null;
    const idx = ranks.findIndex((x: any) => x.name === myName);
    return idx === -1 ? null : idx + 1;
  }, [me?.display_name, ranks]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

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

  const bonusRulesGrouped = useMemo(() => {
    const rules = (data?.bonusRules || []).filter((r) => String(r.ranking_type || "").toLowerCase() !== "team_winner");
    const map = new Map<string, any[]>();
    for (const r of rules) {
      const key = `${r.role}::${r.ranking_type}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    for (const [, arr] of map) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [data?.bonusRules]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Panel</h1>

      {/* Barra de acciones */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 800 }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <button
          onClick={logout}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 800 }}
        >
          Cerrar sesión
        </button>

        <a href="/panel/invoices" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          Mis facturas →
        </a>

        {data?.user?.isAdmin ? (
          <>
            <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
              Admin →
            </a>
            <a
              href="/admin/live"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #111", textDecoration: "none", fontWeight: 900 }}
            >
              Presencia en directo →
            </a>
            <a
              href="/admin/workers"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
            >
              Trabajadores →
            </a>
          </>
        ) : null}
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

      {/* ✅ DASHBOARD RESUMEN (tarjetas) */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 14,
          padding: 14,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {/* Usuario */}
          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ color: "#666", fontSize: 12 }}>Usuario</div>
            <div style={{ fontWeight: 900, marginTop: 4 }}>{me?.display_name || "—"}</div>
            <div style={{ color: "#666", marginTop: 4 }}>
              Rol: <b>{labelRole(me?.role || "—")}</b>
            </div>
            <div style={{ color: "#666", marginTop: 4 }}>
              Mes: <b>{data?.month_date || "—"}</b>
            </div>
          </div>

          {/* Presencia */}
          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ color: "#666", fontSize: 12 }}>Presencia</div>
            <div style={{ marginTop: 6 }}>{pill(pState)}</div>
            <div style={{ marginTop: 10, color: "#666" }}>
              Tiempo: <b>{formatHMS(elapsedSec)}</b>
            </div>
            {sessionId ? <div style={{ marginTop: 6, color: "#999", fontSize: 12 }}>Sesión {sessionId.slice(0, 8)}…</div> : null}
          </div>

          {/* Ganado */}
          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ color: "#666", fontSize: 12 }}>Ganado este mes</div>
            {data?.myEarnings ? (
              <>
                <div style={{ fontWeight: 900, marginTop: 6, fontSize: 18 }}>{eur(data.myEarnings.amount_total_eur)}</div>
                <div style={{ color: "#666", marginTop: 6 }}>
                  Base: <b>{eur(data.myEarnings.amount_base_eur)}</b> · Bonos: <b>{eur(data.myEarnings.amount_bonus_eur)}</b>
                </div>
                <div style={{ color: "#666", marginTop: 6 }}>
                  Minutos: <b>{fmt(data.myEarnings.minutes_total)}</b> · Captadas: <b>{fmt(data.myEarnings.captadas)}</b>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 6, color: "#666" }}>Sin cálculo todavía.</div>
            )}
          </div>

          {/* Admin: pendientes */}
          {data?.user?.isAdmin ? (
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ color: "#666", fontSize: 12 }}>Incidencias pendientes</div>
              <div style={{ fontWeight: 900, marginTop: 6, fontSize: 18 }}>
                {pendingCount === null ? "—" : pendingCount}
              </div>
              <div style={{ color: "#666", marginTop: 6, fontSize: 12 }}>
                (Si es 0 y debería haber, lo revisamos luego)
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ✅ CONTROL HORARIO (botones + crono) */}
      {me?.role === "tarotista" || me?.role === "central" ? (
        <div style={{ border: "1px solid #111", borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 900 }}>Control horario</div>
              <div style={{ color: "#666", marginTop: 4 }}>
                Estado: {pill(pState)}{" "}
                {sessionId ? <span style={{ color: "#999" }}>· sesión {sessionId.slice(0, 8)}…</span> : null}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#666", fontSize: 12 }}>Tiempo logueado</div>
              <div style={{ fontSize: 26, fontWeight: 900 }}>{formatHMS(elapsedSec)}</div>
            </div>
          </div>

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

          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
            Estado persistente: aunque refresques la página, seguirá ONLINE si hay sesión abierta.
          </div>
        </div>
      ) : null}

      {/* TOP 3 */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Top 3 del mes</h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {(["minutes", "repite_pct", "cliente_pct", "captadas"] as RankKey[]).map((k) => (
            <div key={k} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>{labelRanking(k)}</div>
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
            </div>
          ))}
        </div>
      </div>

      {/* BONOS (solo reglas) */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Bonos (reglas)</h2>

        {[...bonusRulesGrouped.keys()].length === 0 ? (
          <div style={{ color: "#666" }}>No hay reglas activas.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {[...bonusRulesGrouped.entries()].map(([key, rules]) => {
              const [role, ranking_type] = key.split("::");
              return (
                <div key={key} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    {labelRole(role)} · {labelRanking(ranking_type)}
                  </div>

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

      {/* RANKINGS */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Rankings (tabla completa)</h2>

        <div style={{ marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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
                <tr key={r.worker_id} style={{ background: isMe ? "#e8f4ff" : "transparent", fontWeight: isMe ? 800 : 400 }}>
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
                  Sin datos todavía.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
