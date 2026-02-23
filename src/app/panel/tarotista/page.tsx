"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

type RankKey = "minutes" | "captadas" | "cliente_pct" | "repite_pct";

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

type PresenceState = "online" | "pause" | "bathroom" | "offline";

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

function TeamBox({
  title,
  team,
}: {
  title: string;
  team: any | null;
}) {
  const shell: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
    padding: 14,
  };

  if (!team) {
    return (
      <div style={shell}>
        <div style={{ fontWeight: 1300, fontSize: 14 }}>{title}</div>
        <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 1100 }}>No hay datos de este equipo.</div>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontWeight: 1400, fontSize: 14 }}>
          {title} · <span style={{ textTransform: "uppercase" }}>{team.team_name}</span>
        </div>
        {typeof team.team_score !== "undefined" ? (
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              fontWeight: 1200,
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
            title="Score = Cliente% + Repite%"
          >
            ⭐ Score {fmt(team.team_score)}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 10 }}>
        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Minutos</div>
          <div style={{ fontWeight: 1400, fontSize: 18 }}>{fmt(team.total_minutes)}</div>
        </div>
        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Captadas</div>
          <div style={{ fontWeight: 1400, fontSize: 18 }}>{fmt(team.total_captadas)}</div>
        </div>

        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Clientes %</div>
          <div style={{ fontWeight: 1400, fontSize: 18 }}>{fmt(team.team_cliente_pct)}%</div>
        </div>
        <div style={{ padding: 12, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff" }}>
          <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Repite %</div>
          <div style={{ fontWeight: 1400, fontSize: 18 }}>{fmt(team.team_repite_pct)}%</div>
        </div>
      </div>

      {Array.isArray(team.members) && team.members.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 1200, marginBottom: 8 }}>Miembros</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {team.members.slice(0, 10).map((m: any) => (
              <span
                key={m.worker_id}
                style={{
                  padding: "7px 10px",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  fontWeight: 1000,
                  fontSize: 12,
                }}
                title={m.worker_id}
              >
                {m.name}
              </span>
            ))}
            {team.members.length > 10 ? (
              <span style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12, alignSelf: "center" }}>
                +{team.members.length - 10} más
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Top3Block({ title, list, k }: { title: string; list: any[]; k: RankKey }) {
  const shell: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
    padding: 14,
  };

  return (
    <div style={shell}>
      <div style={{ fontWeight: 1400, fontSize: 14 }}>{title}</div>
      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {(list || []).length === 0 ? (
          <div style={{ color: "#6b7280", fontWeight: 1100 }}>Sin datos.</div>
        ) : (
          (list || []).slice(0, 3).map((r: any, idx: number) => (
            <div
              key={r.worker_id || `${k}-${idx}`}
              style={{
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#fff",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: 1200 }}>
                {medal(idx + 1)} {idx + 1}. {r.name}
              </div>
              <div style={{ fontWeight: 1400 }}>{valueOf(k, r)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TarotistaPage() {
  const router = useRouter();
  const qs = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [data, setData] = useState<any>(null);

  // rankings
  const [rankType, setRankType] = useState<RankKey>("minutes");

  // presence
  const [pLoading, setPLoading] = useState(false);
  const [pErr, setPErr] = useState<string | null>(null);
  const [pState, setPState] = useState<PresenceState>("offline");
  const [pStartedAt, setPStartedAt] = useState<string | null>(null);

  // chat interno
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatMsg, setChatMsg] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadPresence(token: string) {
    setPErr(null);
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
      // no romper
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
      if (role !== "tarotista") {
        router.replace("/panel");
        return;
      }

      setData(j);

      // presence
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

  // si cambia el mes por querystring, recargar
  useEffect(() => {
    if (!qs) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs?.get("month_date")]);

  async function setPresence(next: PresenceState) {
    setPErr(null);
    setPLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/presence/set", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ state: next }),
      });

      if (r.status === 404) {
        setPErr("No existe /api/presence/set. Dime cuál es tu endpoint real para cambiar estado y lo conecto.");
        return;
      }

      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) {
        setPErr(j?.error || `Error cambiando estado (HTTP ${r.status})`);
        return;
      }

      setPState(next);
      setPStartedAt(j.started_at || null);

      await loadPresence(token);
    } catch (e: any) {
      setPErr(e?.message || "Error cambiando presencia");
    } finally {
      setPLoading(false);
    }
  }

  async function sendInternalMessage() {
    setChatMsg(null);
    if (!message.trim()) {
      setChatMsg("Escribe la lista de clientes antes de enviar.");
      return;
    }

    setSending(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/internal/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: message.trim() }),
      });

      const raw = await r.text().catch(() => "");
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }

      if (!r.ok || !j?.ok) {
        setChatMsg(`Error enviando (HTTP ${r.status}): ${j?.error || raw || "UNKNOWN"}`);
        return;
      }

      setMessage("");
      setChatMsg("✅ Enviado al central.");
      await load();
    } finally {
      setSending(false);
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

  const minutesTotal = data?.myEarnings?.minutes_total ?? null;
  const captadasTotal = data?.myEarnings?.captadas ?? null;
  const totalEur = data?.myEarnings?.amount_total_eur ?? null;

  // ✅ bonos arreglados (del backend nuevo)
  const bonusDynamic = data?.myBonusDynamic ?? data?.myEarnings?.amount_bonus_eur ?? null;
  const bonusInvoice = data?.myBonusInvoice ?? data?.myEarnings?.amount_bonus_invoice_eur ?? null;
  const bonusBreakdown: any[] = Array.isArray(data?.myBonusBreakdown) ? data.myBonusBreakdown : [];

  const incCount = data?.myIncidentsMonth?.count ?? null;
  const incPenalty = data?.myIncidentsMonth?.penalty_eur ?? null;
  const incGrave = !!data?.myIncidentsMonth?.grave;

  const myMessages = useMemo(() => {
    const list = Array.isArray(data?.internalMessages) ? data.internalMessages : [];
    const myId = String(me?.id || "");
    return list.filter((m: any) => String(m?.from_worker_id || "") === myId);
  }, [data?.internalMessages, me?.id]);

  const teamYami = data?.teamYami ?? null;
  const teamMaria = data?.teamMaria ?? null;

  const top3Minutes = Array.isArray(data?.rankings?.minutes) ? data.rankings.minutes.slice(0, 3) : [];
  const top3Captadas = Array.isArray(data?.rankings?.captadas) ? data.rankings.captadas.slice(0, 3) : [];
  const top3Cliente = Array.isArray(data?.rankings?.cliente_pct) ? data.rankings.cliente_pct.slice(0, 3) : [];
  const top3Repite = Array.isArray(data?.rankings?.repite_pct) ? data.rankings.repite_pct.slice(0, 3) : [];

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

      {/* ✅ EQUIPOS (2 CUADRADOS) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <TeamBox title="Equipo 1" team={teamYami} />
        <TeamBox title="Equipo 2" team={teamMaria} />
      </div>

      {/* ✅ TOP 3 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <Top3Block title="Top 3 · Minutos" list={top3Minutes} k="minutes" />
        <Top3Block title="Top 3 · Captadas" list={top3Captadas} k="captadas" />
        <Top3Block title="Top 3 · Clientes %" list={top3Cliente} k="cliente_pct" />
        <Top3Block title="Top 3 · Repite %" list={top3Repite} k="repite_pct" />
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
              <span style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Sin inicio de estado</span>
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

        <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
          * Esto queda conectado al panel admin porque el admin ya lee presencia. Solo falta confirmar tu endpoint real de “set” si no es{" "}
          <b>/api/presence/set</b>.
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
          <CardTitle>Bonos (dinámico)</CardTitle>
          <CardValue>{bonusDynamic == null ? "—" : eur(bonusDynamic)}</CardValue>
          <CardHint>
            {incGrave ? (
              <b style={{ color: "#b91c1c" }}>GRAVE: sin bonos</b>
            ) : (
              <>
                Según reglas.{" "}
                {bonusInvoice != null ? (
                  <span style={{ color: "#6b7280" }}>
                    (Factura: <b>{eur(bonusInvoice)}</b>)
                  </span>
                ) : null}
              </>
            )}
          </CardHint>
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

      {/* ✅ DETALLE DE BONOS */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 1300, fontSize: 16 }}>Bonos · Detalle</div>
          <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>
            Total: <b>{bonusDynamic == null ? "—" : eur(bonusDynamic)}</b>
          </div>
        </div>

        {incGrave ? (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 14, border: "1px solid #ffcccc", background: "#fff3f3", fontWeight: 1100 }}>
            ⚠️ Este mes tienes una incidencia <b>grave</b>. Por norma: <b>sin bonos</b>.
          </div>
        ) : null}

        <div style={{ marginTop: 10 }}>
          {bonusBreakdown.length === 0 ? (
            <div style={{ color: "#6b7280", fontWeight: 1000 }}>No hay desglose (o no has entrado en posiciones con bono).</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {bonusBreakdown.map((b: any, i: number) => (
                <div
                  key={i}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 1100 }}>
                    {b.reason || b.ranking_type}{" "}
                    {b.position ? (
                      <span style={{ color: "#6b7280", fontWeight: 900 }}>
                        · Pos <b>#{b.position}</b>
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontWeight: 1400 }}>{eur(b.amount_eur)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {bonusInvoice != null ? (
          <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
            * “Factura” es lo que tengas guardado en <b>worker_invoices.bonuses_eur</b>. El “Dinámico” sale de <b>bonus_rules</b> + tu posición real.
          </div>
        ) : null}
      </div>

      {/* NOTIFICACIONES */}
      {Array.isArray(data?.notifications) && data.notifications.length > 0 ? (
        <div style={{ ...shellCard, padding: 14, border: "1px solid #ffe0b2", background: "#fff7ed" }}>
          <div style={{ fontWeight: 1300, marginBottom: 8 }}>Notificaciones</div>
          <div style={{ display: "grid", gap: 6 }}>
            {data.notifications.map((n: string, i: number) => (
              <div key={i} style={{ fontWeight: 1000, color: "#9a3412" }}>
                • {n}
              </div>
            ))}
          </div>
        </div>
      ) : null}

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

        <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
          * Mostrando Top 10.
        </div>
      </div>

      {/* CHAT INTERNO */}
      <div style={{ ...shellCard, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontWeight: 1300, fontSize: 16 }}>Enviar lista de clientes al Central</div>
          <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>
            {data?.pendingInternalCount ? <b>{fmt(data.pendingInternalCount)} pendientes</b> : <span>Sin pendientes</span>}
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Ej: 17:00 Laura · 17:20 María · 17:40 Ana..."
            style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", fontWeight: 900 }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button style={btn} disabled={sending} onClick={sendInternalMessage}>
              {sending ? "Enviando…" : "📨 Enviar al central"}
            </button>
            <button style={btnGhost} onClick={() => load()}>
              🔄 Refrescar
            </button>
          </div>

          {chatMsg ? (
            <div style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 900 }}>
              {chatMsg}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 1200, marginBottom: 8 }}>Tus mensajes</div>
          {myMessages.length === 0 ? (
            <div style={{ color: "#6b7280", fontWeight: 900 }}>Aún no has enviado mensajes.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {myMessages.slice(0, 10).map((m: any) => (
                <div
                  key={m.id}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ fontWeight: 1100 }}>{m.content}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
                      {m.created_at ? new Date(m.created_at).toLocaleString("es-ES") : ""}
                    </div>
                    <div style={{ fontWeight: 1200, fontSize: 12, color: m.is_checked ? "#166534" : "#92400e" }}>
                      {m.is_checked ? "✔ Confirmado por Central" : "⏳ Pendiente"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
