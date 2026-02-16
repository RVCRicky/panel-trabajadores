"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type InvoiceRow = {
  id: string;
  month_date: string;
  status: "pending" | "accepted" | "rejected" | string;
  response_note: string | null;
  responded_at: string | null;
  created_at: string | null;
  signed_url: string | null;
};

export default function MyInvoicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<InvoiceRow[]>([]);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  async function getToken(): Promise<string | null> {
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

      const res = await fetch("/api/invoices/my", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setErr(json?.error || `Error (${res.status})`);
        return;
      }

      const list: InvoiceRow[] = json.invoices || [];
      setItems(list);

      // Inicializar notas (si vienen)
      const nextNotes: Record<string, string> = {};
      for (const inv of list) nextNotes[inv.id] = inv.response_note || "";
      setNoteById(nextNotes);
    } catch (e: any) {
      setErr(e?.message || "Error cargando facturas");
    } finally {
      setLoading(false);
    }
  }

  async function respond(invoice_id: string, action: "accepted" | "rejected") {
    setErr(null);
    setActingId(invoice_id);

    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const note = (noteById[invoice_id] || "").trim();

      const res = await fetch("/api/invoices/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ invoice_id, action, note }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setErr(json?.error || `Error (${res.status})`);
        return;
      }

      await load();
    } catch (e: any) {
      setErr(e?.message || "Error respondiendo factura");
    } finally {
      setActingId(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Mis facturas</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <a
          href="/panel"
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
          }}
        >
          ← Volver al panel
        </a>

        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            fontWeight: 800,
          }}
        >
          {loading ? "Cargando..." : "Actualizar"}
        </button>
      </div>

      {err ? (
        <div
          style={{
            padding: 10,
            border: "1px solid #ffcccc",
            background: "#fff3f3",
            borderRadius: 10,
            marginBottom: 12,
          }}
        >
          {err}
        </div>
      ) : null}

      {loading ? (
        <div style={{ color: "#666" }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div style={{ color: "#666" }}>No tienes facturas todavía.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Mes</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Estado</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>PDF</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nota</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Acción</th>
              </tr>
            </thead>

            <tbody>
              {items.map((inv) => {
                const isPending = inv.status === "pending";
                const isBusy = actingId === inv.id;

                return (
                  <tr key={inv.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{inv.month_date}</td>

                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      <b>{inv.status}</b>
                    </td>

                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      {inv.signed_url ? (
                        <a href={inv.signed_url} target="_blank" rel="noreferrer">
                          Ver / Descargar
                        </a>
                      ) : (
                        <span style={{ color: "#666" }}>Sin link</span>
                      )}
                    </td>

                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      <input
                        value={noteById[inv.id] ?? ""}
                        onChange={(e) => setNoteById((p) => ({ ...p, [inv.id]: e.target.value }))}
                        placeholder="(opcional) Escribe un comentario…"
                        disabled={!isPending || isBusy}
                        style={{
                          width: 320,
                          maxWidth: "100%",
                          padding: 8,
                          borderRadius: 10,
                          border: "1px solid #ddd",
                        }}
                      />
                    </td>

                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      {isPending ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            onClick={() => respond(inv.id, "accepted")}
                            disabled={isBusy}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #111",
                              fontWeight: 800,
                            }}
                          >
                            {isBusy ? "…" : "Conforme"}
                          </button>

                          <button
                            onClick={() => respond(inv.id, "rejected")}
                            disabled={isBusy}
                            style={{
                              padding: "8px 10px",
                              borderRadius: 10,
                              border: "1px solid #111",
                              background: "#111",
                              color: "#fff",
                              fontWeight: 800,
                            }}
                          >
                            {isBusy ? "…" : "No conforme"}
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: "#666" }}>
                          Respondida {inv.responded_at ? `(${new Date(inv.responded_at).toLocaleString("es-ES")})` : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
            Nota: los links al PDF son temporales (se regeneran al recargar).
          </div>
        </div>
      )}
    </div>
  );
}
