"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type InvoiceAdminRow = {
  id: string;
  worker_id: string;
  month_date: string;
  file_path: string;
  status: string;
  response_note: string | null;
  responded_at: string | null;
  created_at: string | null;
  signed_url: string | null;
  worker?: { display_name: string; role: string } | null;
};

export default function AdminInvoicesListPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<InvoiceAdminRow[]>([]);

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

      const res = await fetch("/api/admin/invoices/list?limit=300", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || `Error (${res.status})`);
        return;
      }

      setItems(j.invoices || []);
    } catch (e: any) {
      setErr(e?.message || "Error cargando facturas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Facturas (todas)</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <a
          href="/admin"
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
          }}
        >
          ← Volver a Admin
        </a>

        <a
          href="/admin/invoices"
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ddd",
            textDecoration: "none",
          }}
        >
          Subir factura →
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
        <div style={{ color: "#666" }}>No hay facturas todavía.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Fecha subida</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Mes</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Trabajador</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Rol</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Estado</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nota</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {items.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#333" }}>
                    {inv.created_at ? new Date(inv.created_at).toLocaleString("es-ES") : "—"}
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{inv.month_date}</td>

                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                    <b>{inv.worker?.display_name || inv.worker_id}</b>
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>
                    {inv.worker?.role || "—"}
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                    <b>{inv.status}</b>
                    {inv.responded_at ? (
                      <span style={{ color: "#666" }}> · {new Date(inv.responded_at).toLocaleString("es-ES")}</span>
                    ) : null}
                  </td>

                  <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#333" }}>
                    {inv.response_note || "—"}
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
                </tr>
              ))}
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
