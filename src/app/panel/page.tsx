"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

type RankKey = "minutes" | "captadas" | "cliente_pct" | "repite_pct";
type PresenceState = "online" | "pause" | "bathroom" | "offline";

function fmt(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES");
}
function eur(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function medal(pos: number) {
  return pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "";
}

function labelRanking(k: RankKey) {
  if (k === "minutes") return "Minutos";
  if (k === "captadas") return "Captadas";
  if (k === "cliente_pct") return "Clientes %";
  if (k === "repite_pct") return "Repite %";
  return k;
}

function valueOf(k: RankKey, r: any) {
  if (k === "minutes") return `${fmt(r.minutes)} min`;
  if (k === "captadas") return fmt(r.captadas);
  if (k === "cliente_pct") return `${fmt(r.cliente_pct)} %`;
  if (k === "repite_pct") return `${fmt(r.repite_pct)} %`;
  return "";
}

function presenceTone(st: PresenceState) {
  if (st === "online") return "ok";
  if (st === "pause" || st === "bathroom") return "warn";
  return "neutral";
}
function presenceText(st: PresenceState) {
  if (st === "online") return "ONLINE";
  if (st === "pause") return "PAUSA";
  if (st === "bathroom") return "BAÑO";
  return "OFFLINE";
}

async function readJsonSafe(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    return { json: text ? JSON.parse(text) : null, text };
  } catch {
    return { json: null, text };
  }
}

// ✅ comparar strings sin acentos (María vs maria)
function fold(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default function PanelTarotistaPage() {
  const router = useRouter();
  const qs = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [data, setData] = useState<any>(null);

  const [rankType, setRankType] = useState<RankKey>("minutes");

  // presence
  const [pLoading, setPLoading] = useState(false);
  const [pErr, setPErr] = useState<string | null>(null);
  const [pState, setPState] = useState<PresenceState>("offline");
  const [pStartedAt, setPStartedAt] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadPresence(token: string) {
    try {
      const r = await fetch("/api/presence/me", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = await r.json().catch(() => null);
      if (!j?.ok) return;

      const st = String(j.state || "offline") as PresenceState;
      setPState(st);
      setPStartedAt(j.started_at || null);
    } catch {
      // no romper UI
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

      const month = qs.get("month_date");
      const q = month ? `?month_date=${encodeURIComponent(month)}` : "";

      const res = await fetch(`/api/dashboard/full${q}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error dashboard");
        setData(null);
        return;
      }

      const role = String(j?.user?.worker?.role || "").toLowerCase();

      // ✅ seguridad: si entra otro rol aquí, lo mandamos a su sitio
      if (role === "central") {
        router.replace(`/panel/central${q}`);
        return;
      }
      if (role === "admin") {
        router.replace(`/admin/panel${q}`);
        return;
      }
      if (role !== "tarotista") {
        router.replace("/login");
        return;
      }

      setData(j);

      await loadPresence(token);
    } catch (e: any) {
      setErr(e?.message || "Error cargando panel");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs?.get("month_date")]);

  // ✅ CONECTADO A TUS ROUTES REALES (POST)
  async function setPresence(next: PresenceState) {
    setPErr(null);
    setPLoading(true);

    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const doPost = async (url: string, body: any) => {
        return fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body || {}),
        });
      };

      let r: Response;

      if (next === "online") {
        r = await doPost("/api/presence/login", {});
      } else if (next === "offline") {
        r = await doPost("/api/presence/logout", {});
      } else {
        // pause / bathroom (state)
        r = await doPost("/api/presence/state", { state: next });
      }

      const { json, text } = await readJsonSafe(r);
      if (!r.ok || !json?.ok) {
        const code = json?.error || "";
        if (code === "NO_ACTIVE_SESSION") {
          setPErr("No tienes sesión activa. Pulsa primero ✅ ONLINE y luego ya podrás PAUSA/BAÑO.");
          return;
        }
        setPErr(code ? `Error: ${code}` : `Error (HTTP ${r.status}): ${text.slice(0, 200)}`);
        return;
      }

      // ✅ refrescar desde /api/presence/me (es la fuente buena de started_at/state)
      await loadPresence(token);
      setPState(next);
    } catch (e: any) {
      setPErr(e?.message || "Error cambiando presencia");
    } finally {
      setPLoading(false);
    }
  }

  const me = data?.user?.worker || null;

  const ranks: any[] = useMemo(() => {
    const list = (data?.rankings as any)?.[rankType] || [];
    return Array.isArray(list) ? list : [];
  }, [data?.rankings, rankType]);

  const myRank = useMemo(() => {
    const myName = me?.display_name;
    if (!myName) return null;
    const idx = ranks.findIndex((x: any) => x?.name === myName);
    return idx === -1 ? null : idx + 1;
  }, [me?.display_name, ranks]);

  const top10 = ranks.slice(0, 10);
  const top3 = ranks.slice(0, 3);

  const minutesTotal = data?.myEarnings?.minutes_total ?? null;
  const captadasTotal = data?.myEarnings?.captadas ?? null;
  const totalEur = data?.myEarnings?.amount_total_eur ?? null;
  const bonusEur = data?.myEarnings?.amount_bonus_eur ?? null;

  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;
  const incGrave = !!data?.myIncidentsMonth?.grave;

  // equipos (ya vienen del full route)
  const teamYami = data?.teamYami || null;
  const teamMaria = data?.teamMaria || null;

  // fallback extra por si en algún momento te viene como "María" y no cuadra:
  const forceTeamName = (t: any, wanted: "yami" | "maria") => {
    if (!t) return t;
    const name = String(t.team_name || "");
    if (wanted === "maria" && fold(name).includes("maria")) return t;
    if (wanted === "yami" && fold(name).includes("yami")) return t;
    return t;
  };

  const shellCard: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    fontWeight: 1100,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const btnGhost: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111",
    fontWeight: 1100,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const TeamBox = ({ title, t }: { title: string; t: any }) => {
    const has = !!t?.team_id;
    return (
      <div style={{ border: "2px solid #111", borderRadius: 16, padding: 12, background: "#fff", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ fontWeight: 1300 }}>{title}</div>
          <div style={{ fontWeight: 1400 }}>{has ? String(t.team_name || "").toUpperCase() : "SIN DATOS"}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
          <div style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fafafa" }}>
            <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Minutos</div>
            <div style={{ fontWeight: 1400 }}>{has ? fmt(t.total_minutes) : "—"}</div>
          </div>
          <div style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fafafa" }}>
            <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Captadas</div>
            <div style={{ fontWeight: 1400 }}>{has ? fmt(t.total_captadas) : "—"}</div>
          </div>
          <div style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fafafa" }}>
            <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Score</div>
            <div style={{ fontWeight: 1400 }}>{has ? fmt(t.team_score) : "—"}</div>
          </div>
        </div>

        {has && Array.isArray(t.members) && t.members.length > 0 ? (
          <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
            Miembros:{" "}
            <b style={{ color: "#111" }}>
              {t.members
                .filter((m: any) => String(m?.role || "").toLowerCase() === "tarotista")
                .map((m: any) => m.name)
                .slice(0, 10)
                .join(" · ")}
            </b>
          </div>
        ) : (
          <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>Miembros: —</div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <div style={{ fontWeight: 1200, color: "#6b7280" }}>Cargando panel…</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, width: "100%" }}>
      {err ? (
        <div style={{ ...shellCard, padding: 14, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 1100 }}>
          {err}
        </div>
      ) : null}

      {/* EQUIPOS FIJOS */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <TeamBox title="Equipo 1" t={forceTeamName(teamYami, "yami")} />
        <TeamBox title="Equipo 2" t={forceTeamName(teamMaria, "maria")} />
      </div>

      {/* PRESENCIA / LOGUEO */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 1300, fontSize: 16 }}>Fichaje / Presencia</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Badge tone={presenceTone(pState) as any}>{presenceText(pState)}</Badge>
            {pStartedAt ? (
              <span style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>
                Desde: <b>{new Date(pStartedAt).toLocaleString("es-ES")}</b>
              </span>
            ) : (
              <span style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Sin inicio</span>
            )}
          </div>
        </div>

        {pErr ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 900 }}>
            {pErr}
          </div>
        ) : null}

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={btn} disabled={pLoading} onClick={() => setPresence("online")}>
            ✅ ONLINE
          </button>
          <button style={btnGhost} disabled={pLoading} onClick={() => setPresence("pause")}>
            ⏸️ PAUSA
          </button>
          <button style={btnGhost} disabled={pLoading} onClick={() => setPresence("bathroom")}>
            🚻 BAÑO
          </button>
          <button style={btnGhost} disabled={pLoading} onClick={() => setPresence("offline")}>
            ⛔ OFFLINE
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Minutos del mes</CardTitle>
          <CardValue>{minutesTotal == null ? "—" : fmt(minutesTotal)}</CardValue>
          <CardHint>Acumulados</CardHint>
        </Card>

        <Card>
          <CardTitle>Captadas del mes</CardTitle>
          <CardValue>{captadasTotal == null ? "—" : fmt(captadasTotal)}</CardValue>
          <CardHint>Acumuladas</CardHint>
        </Card>

        <Card>
          <CardTitle>Total €</CardTitle>
          <CardValue>{totalEur == null ? "—" : eur(totalEur)}</CardValue>
          <CardHint>Factura del mes</CardHint>
        </Card>

        <Card>
          <CardTitle>Bonos</CardTitle>
          <CardValue>{bonusEur == null ? "—" : eur(bonusEur)}</CardValue>
          <CardHint>{incGrave ? <b style={{ color: "#b91c1c" }}>GRAVE: sin bonos</b> : "Según reglas"}</CardHint>
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
          <CardHint>{labelRanking(rankType)}</CardHint>
        </Card>
      </div>

      {/* TOP 3 */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ fontWeight: 1300, fontSize: 16 }}>Top 3 ({labelRanking(rankType)})</div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {top3.length === 0 ? (
            <div style={{ color: "#6b7280", fontWeight: 900 }}>Sin datos.</div>
          ) : (
            top3.map((r: any, idx: number) => (
              <div key={r.worker_id || idx} style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#fff" }}>
                <div style={{ fontWeight: 1400 }}>
                  {medal(idx + 1)} #{idx + 1} {r.name}
                </div>
                <div style={{ marginTop: 6, fontWeight: 1400 }}>{valueOf(rankType, r)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* RANKING */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 1300, fontSize: 16 }}>Ranking</div>
          <div style={{ color: "#6b7280", fontWeight: 1000 }}>
            Mi posición: <b>{myRank ? `${medal(myRank)} #${myRank}` : "—"}</b>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(["minutes", "captadas", "cliente_pct", "repite_pct"] as RankKey[]).map((k) => {
            const active = rankType === k;
            return (
              <button
                key={k}
                onClick={() => setRankType(k)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 999,
                  border: active ? "1px solid #111" : "1px solid #e5e7eb",
                  background: active ? "#111" : "#fff",
                  color: active ? "#fff" : "#111",
                  fontWeight: 1100,
                  cursor: "pointer",
                }}
              >
                {labelRanking(k)}
              </button>
            );
          })}
        </div>

        <div style={{ overflowX: "auto", marginTop: 12, width: "100%" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 10 }}>#</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 10 }}>Nombre</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #e5e7eb", padding: 10 }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((r: any, idx: number) => {
                const pos = idx + 1;
                const isMe = me?.display_name && r?.name === me.display_name;
                return (
                  <tr key={r.worker_id || `${idx}`} style={{ background: isMe ? "#eef6ff" : "transparent" }}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", fontWeight: 1100 }}>
                      {medal(pos)} {pos}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", fontWeight: isMe ? 1200 : 900 }}>
                      {r.name} {isMe ? "· (Tú)" : ""}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", textAlign: "right", fontWeight: 1300 }}>
                      {valueOf(rankType, r)}
                    </td>
                  </tr>
                );
              })}
              {top10.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: 12, color: "#6b7280", fontWeight: 900 }}>
                    Sin datos.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Botón refresh rápido */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={btnGhost} onClick={() => load()}>
          🔄 Refrescar
        </button>
      </div>
    </div>
  );
}
