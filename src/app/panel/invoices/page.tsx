"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Invoice = {
  id: string;
  worker_id: string;
  month_date: string;
  status: string;
  total_eur: number;
  worker_note: string | null;
  admin_note: string | null;
  locked_at: string | null;
};

type Line = {
  id: string;
  kind: string;
  label: string;
  amount_eur: number;
  is_manual: boolean;
  created_at: string;
};

function euro(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function monthLabel(isoDate: string) {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  } catch {
    return isoDate;
  }
}

type StatusChoice = "accepted" | "rejected" | "review";

export default function MyInvoicesPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadMyInvoices() {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/invoices/my", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }

      if (!r.ok || !j?.ok) {
        setErr(`Error HTTP ${r.status}. ${j?.error || raw || "(vacío)"}`);
        return;
      }

      const list: Invoice[] = j.invoices || [];
      setInvoices(list);
      if (!selected) setSelected(list.length ? list[0] : null);
      setStatus("OK");
    } finally {
      setLoading(false);
    }
  }

  async function loadLines(invoiceId: string) {
    setErr(null);
    setLines([]);
    const token = await getToken();
    if (!token) return router.replace("/login");

    const r = await fetch(`/api/invoices/lines?invoiceId=${encodeURIComponent(invoiceId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const raw = await r.text();
    let j: any = null;
    try {
      j = raw ? JSON.parse(raw) : null;
    } catch {
      j = null;
    }

    if (!r.ok || !j?.ok) {
      setErr(`Error HTTP ${r.status}. ${j?.error || raw || "(vacío)"}`);
      return;
    }

    setLines(j.lines || []);
  }

  useEffect(() => {
    loadMyInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    setNote(selected.worker_note || "");
    loadLines(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  async function respond(nextStatus: StatusChoice) {
    setErr(null);
    if (!selected) return;

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/invoices/respond", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invoiceId: selected.id,
          status: nextStatus,
          workerNote: note.trim() || null,
        }),
      });

      const raw = await r.text();
      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }

      if (!r.ok || !j?.ok) {
        setErr(`Error HTTP ${r.status}. ${j?.error || raw || "(vacío)"}`);
        return;
      }

      await loadMyInvoices();
      // refrescar el seleccionado
      const again = (invoices || []).find((x) => x.id === selected.id) || null;
      if (again) setSelected(again);
    } finally {
      setLoading(false);
    }
  }

  async function openPdf() {
    setErr(null);
    if (!selected) return;

    const token = await getToken();
    if (!token) return router.replace("/login");

    // abrimos en nueva pestaña
    const url = `/api/invoices/pdf?invoiceId=${encodeURIComponent(selected.id)}`;

    // fetch para no perder auth (Bearer). Abrimos blob.
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      setErr(`PDF error HTTP ${r.status}. ${t || "(vacío)"}`);
      return;
    }
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  }

  const head = useMemo(() => {
    if (!selected) return null;
    return {
      month: monthLabel(selected.month_date),
      total: euro(selected.total_eur),
      state: selected.locked_at ? "CERRADA" : "ABIERTA",
      status: String(selected.status || "").toUpperCase(),
    };
  }, [selected]);

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 980 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Mis facturas</h1>

        <button
          onClick={loadMyInvoices}
          disabled={loading}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900, cursor: "pointer" }}
        >
          {loading ? "Cargando..." : "Actualizar"}
        </button>

        <a
          href="/panel"
          style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}
        >
          ← Volver
        </a>
      </div>

      {err ? <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10 }}>{err}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12 }}>
        {/* Lista */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Facturas</div>

          <div style={{ display: "grid", gap: 8, maxHeight: 520, overflow: "auto" }}>
            {invoices.length === 0 ? (
              <div style={{ color: "#666" }}>No hay facturas todavía.</div>
            ) : (
              invoices.map((i) => {
                const active = selected?.id === i.id;
                return (
                  <button
                    key={i.id}
                    onClick={() => setSelected(i)}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderRadius: 12,
                      border: active ? "2px solid #111" : "1px solid #ddd",
                      background: active ? "#f6f6f6" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{monthLabel(i.month_date)}</div>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      {i.locked_at ? "CERRADA" : "ABIERTA"} · {String(i.status || "").toUpperCase()} ·{" "}
                      <b style={{ color: "#111" }}>{euro(i.total_eur)}</b>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detalle */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          {!selected ? (
            <div style={{ color: "#666" }}>Selecciona una factura.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>{head?.month}</div>
                <div style={{ marginLeft: "auto", color: "#666" }}>
                  {head?.state} · {head?.status} · Total: <b style={{ color: "#111" }}>{head?.total}</b>
                </div>
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={openPdf}
                  style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900, cursor: "pointer" }}
                >
                  Ver / Descargar PDF
                </button>

                {selected.locked_at ? (
                  <div style={{ color: "#666", display: "flex", alignItems: "center" }}>
                    Esta factura está cerrada. Solo puedes responder (aceptar/rechazar/revisión).
                  </div>
                ) : (
                  <div style={{ color: "#666", display: "flex", alignItems: "center" }}>
                    Esta factura aún está abierta (el admin puede ajustarla).
                  </div>
                )}
              </div>

              <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Líneas</div>

                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Concepto</th>
                      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>€</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={2} style={{ padding: 10, color: "#666" }}>
                          Sin líneas.
                        </td>
                      </tr>
                    ) : (
                      lines.map((l) => (
                        <tr key={l.id}>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{l.label}</td>
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right", fontWeight: 900 }}>
                            {euro(l.amount_eur)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Tu respuesta</div>

                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Escribe aquí tu comentario si quieres (opcional)"
                  style={{ width: "100%", minHeight: 90, padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    onClick={() => respond("accepted")}
                    disabled={loading}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 900, cursor: "pointer" }}
                  >
                    Aceptar
                  </button>

                  <button
                    onClick={() => respond("review")}
                    disabled={loading}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900, cursor: "pointer" }}
                  >
                    En revisión
                  </button>

                  <button
                    onClick={() => respond("rejected")}
                    disabled={loading}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900, cursor: "pointer" }}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
