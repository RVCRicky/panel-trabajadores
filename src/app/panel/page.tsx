"use client";

import { useEffect, useMemo, useState } from "react";
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

  allEarnings: null | Array<{
    worker_id: string;
    name: string;
    role: string;
    minutes_total: number;
    captadas: number;
    amount_base_eur: number;
    amount_bonus_eur: number;
    amount_total_eur: number;
  }>;
};

type AdminSortKey = "total" | "minutes" | "captadas" | "base" | "bonus";

export default function PanelPage() {
  const router = useRouter();

  const [rankType, setRankType] = useState<"minutes" | "repite_pct" | "cliente_pct" | "captadas">("minutes");
  const [adminSort, setAdminSort] = useState<AdminSortKey>("total");

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DashboardResp | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
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
    } catch (e: any) {
      setErr(e?.message || "Error dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = data?.user?.worker || null;
  const ranks = data?.rankings?.[rankType] || [];

  const myRank = useMemo(() => {
    const myName = me?.display_name;
    if (!myName) return null;
    const idx = ranks.findIndex((x: any) => x.name === myName);
    return idx === -1 ? null : idx + 1;
  }, [me?.display_name, ranks]);

  const sortedAllEarnings = useMemo(() => {
    const list = data?.allEarnings || [];
    const copy = [...list];
    const val = (x: any) => {
      if (adminSort === "total") return Number(x.amount_total_eur || 0);
      if (adminSort === "minutes") return Number(x.minutes_total || 0);
      if (adminSort === "captadas") return Number(x.captadas || 0);
      if (adminSort === "base") return Number(x.amount_base_eur || 0);
      if (adminSort === "bonus") return Number(x.amount_bonus_eur || 0);
      return 0;
    };
    copy.sort((a, b) => val(b) - val(a));
    return copy;
  }, [data?.allEarnings, adminSort]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Panel</h1>

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
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            fontWeight: 800,
          }}
        >
          Cerrar sesión
        </button>

        {data?.user?.isAdmin ? (
          <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
            Ir a Admin →
          </a>
        ) : null}

        <a
          href="/panel/invoices"
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
        >
          Mis facturas →
        </a>
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

      {/* Cabecera */}
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ color: "#666" }}>
          Mes: <b>{data?.month_date || "—"}</b>
        </div>
        <div style={{ marginTop: 6 }}>
          Usuario: <b>{me?.display_name || "—"}</b> · Rol: <b>{me?.role || "—"}</b>
        </div>
      </div>

      {/* Ganado */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Ganado este mes</h2>

        {data?.myEarnings ? (
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#111" }}>
            <div>
              <b>Minutos:</b> {fmt(data.myEarnings.minutes_total)}
            </div>
            <div>
              <b>Captadas:</b> {fmt(data.myEarnings.captadas)}
            </div>
            <div>
              <b>Base:</b> {eur(data.myEarnings.amount_base_eur)}
            </div>
            <div>
              <b>Bonos:</b> {eur(data.myEarnings.amount_bonus_eur)} <span style={{ color: "#666" }}>(cap 20€)</span>
            </div>
            <div>
              <b>Total:</b> {eur(data.myEarnings.amount_total_eur)}
            </div>
          </div>
        ) : (
          <div style={{ color: "#666" }}>Sin cálculo todavía (admin debe recalcular mes).</div>
        )}
      </div>

      {/* Rankings */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Rankings (mes)</h2>

        <div style={{ marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select value={rankType} onChange={(e) => setRankType(e.target.value as any)} style={{ padding: 8 }}>
            <option value="minutes">1) Ranking por Minutos</option>
            <option value="repite_pct">2) Ranking por % Repite</option>
            <option value="cliente_pct">3) Ranking por % Cliente</option>
            <option value="captadas">4) Ranking por Captadas</option>
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
              return (
                <tr key={r.worker_id} style={{ background: isMe ? "#e8f4ff" : "transparent", fontWeight: isMe ? 800 : 400 }}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                    {medal(pos)} {pos}
                  </td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{r.name}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                    {rankType === "minutes"
                      ? fmt(r.minutes)
                      : rankType === "captadas"
                      ? fmt(r.captadas)
                      : rankType === "repite_pct"
                      ? `${r.repite_pct} %`
                      : rankType === "cliente_pct"
                      ? `${r.cliente_pct} %`
                      : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
          Nota: % Repite = minutos repite / minutos totales del mes. % Cliente igual.
        </div>
      </div>

      {/* Admin: Ganado por todos + ordenar */}
      {data?.user?.isAdmin && data?.allEarnings ? (
        <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Admin · Ganado por persona (mes)</h2>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#666" }}>Ordenar por:</span>
              <select value={adminSort} onChange={(e) => setAdminSort(e.target.value as AdminSortKey)} style={{ padding: 8 }}>
                <option value="total">Total €</option>
                <option value="base">Base €</option>
                <option value="bonus">Bonos €</option>
                <option value="minutes">Minutos</option>
                <option value="captadas">Captadas</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nombre</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Rol</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Minutos</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Captadas</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Base</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Bonos</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: 8 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {sortedAllEarnings.map((x) => (
                  <tr key={x.worker_id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      <b>{x.name}</b>
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>{x.role}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(x.minutes_total)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{fmt(x.captadas)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{eur(x.amount_base_eur)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>{eur(x.amount_bonus_eur)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                      <b>{eur(x.amount_total_eur)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
            Los bonos están capados a 20€ por persona (ver monthly_earnings.bonus_cap_eur).
          </div>
        </div>
      ) : null}
    </div>
  );
}
