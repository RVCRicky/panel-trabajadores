"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardTitle, CardValue, CardHint } from "@/components/ui/Card";

export default function TarotistaDashboard() {
  const router = useRouter();
  const qs = useSearchParams();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function load() {
    const token = await getToken();
    if (!token) return router.replace("/login");

    const month = qs.get("month_date");
    const q = month ? `?month_date=${month}` : "";

    const res = await fetch(`/api/dashboard/full${q}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const j = await res.json();
    setData(j);
    setLoading(false);
  }

  async function sendMessage() {
    if (!message.trim()) return;
    setSending(true);

    const token = await getToken();

    await fetch("/api/internal/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: message }),
    });

    setMessage("");
    setSending(false);
    load();
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <div style={{ padding: 20 }}>Cargando panel...</div>;

  const me = data.user.worker;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <Card>
          <CardTitle>Minutos</CardTitle>
          <CardValue>{data.myEarnings?.minutes_total || 0}</CardValue>
          <CardHint>Mes actual</CardHint>
        </Card>

        <Card>
          <CardTitle>Captadas</CardTitle>
          <CardValue>{data.myEarnings?.captadas || 0}</CardValue>
        </Card>

        <Card>
          <CardTitle>Total €</CardTitle>
          <CardValue>{data.myEarnings?.amount_total_eur || 0} €</CardValue>
        </Card>

        <Card>
          <CardTitle>Bonos</CardTitle>
          <CardValue>{data.myEarnings?.amount_bonus_eur || 0} €</CardValue>
        </Card>
      </div>

      {/* Notificaciones */}
      {data.notifications?.length > 0 && (
        <Card>
          <CardTitle>Notificaciones</CardTitle>
          {data.notifications.map((n: string, i: number) => (
            <div key={i} style={{ padding: 6, color: "#b91c1c", fontWeight: 600 }}>
              • {n}
            </div>
          ))}
        </Card>
      )}

      {/* Chat inicio turno */}
      <Card>
        <CardTitle>Enviar lista de clientes al central</CardTitle>

        <textarea
          style={{ width: "100%", padding: 12, borderRadius: 10, border: "1px solid #ddd" }}
          rows={4}
          placeholder="Ej: María - 17:00, Laura - 17:20..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <button
          onClick={sendMessage}
          disabled={sending}
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 8,
            border: "none",
            background: "#111",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {sending ? "Enviando..." : "Enviar al central"}
        </button>
      </Card>

      {/* Mensajes confirmados */}
      <Card>
        <CardTitle>Estado de mensajes</CardTitle>

        {data.internalMessages
          .filter((m: any) => m.from_worker_id === me.id)
          .map((m: any) => (
            <div key={m.id} style={{ padding: 8 }}>
              <div>{m.content}</div>
              <div style={{ fontSize: 12, color: m.is_checked ? "green" : "orange" }}>
                {m.is_checked ? "✔ Confirmado por central" : "Pendiente"}
              </div>
            </div>
          ))}
      </Card>
    </div>
  );
}
