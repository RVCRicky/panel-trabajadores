"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";

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
  return (Number(n) || 0).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}

function medal(pos: number) {
  return pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "";
}

export default function TarotistaDashboard() {
  const router = useRouter();
  const qs = useSearchParams();
  const isMobile = useIsMobile();

  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load() {
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
        setErr(j?.error || "Error cargando dashboard");
        return;
      }

      const role = String(j.user?.worker?.role || "").toLowerCase();

      // 🔐 Seguridad extra
      if (role !== "tarotista") {
        router.replace("/panel");
        return;
      }

      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Error inesperado");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, []);

  const me = data?.user?.worker || null;
  const rankings = data?.rankings?.minutes || [];

  const myRank = useMemo(() => {
    if (!me?.display_name) return null;
    const idx = rankings.findIndex((r: any) => r.name === me.display_name);
    return idx === -1 ? null : idx + 1;
  }, [rankings, me?.display_name]);

  if (loading) {
    return (
      <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <div style={{ fontWeight: 1200, color: "#6b7280" }}>
          Cargando tu panel…
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ padding: 20, color: "#b91c1c", fontWeight: 1100 }}>
        {err}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, width: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        <Card>
          <CardTitle>Minutos</CardTitle>
          <CardValue>{fmt(data?.myEarnings?.minutes_total)}</CardValue>
          <CardHint>Acumulados del mes</CardHint>
        </Card>

        <Card>
          <CardTitle>Captadas</CardTitle>
          <CardValue>{fmt(data?.myEarnings?.captadas)}</CardValue>
          <CardHint>Acumuladas del mes</CardHint>
        </Card>

        <Card>
          <CardTitle>Total €</CardTitle>
          <CardValue>{eur(data?.myEarnings?.amount_total_eur)}</CardValue>
          <CardHint>Factura oficial</CardHint>
        </Card>

        <Card>
          <CardTitle>Mi posición</CardTitle>
          <CardValue>
            {myRank ? `${medal(myRank)} #${myRank}` : "—"}
          </CardValue>
          <CardHint>Ranking por minutos</CardHint>
        </Card>
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 14 }}>
        <div style={{ fontWeight: 1200, marginBottom: 8 }}>
          Ranking del mes
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {rankings.slice(0, 10).map((r: any, idx: number) => (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderRadius: 12,
                background: me?.display_name === r.name ? "#eef6ff" : "#fafafa",
              }}
            >
              <div>
                {medal(idx + 1)} {idx + 1}. {r.name}
              </div>
              <div style={{ fontWeight: 1200 }}>{fmt(r.minutes)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
