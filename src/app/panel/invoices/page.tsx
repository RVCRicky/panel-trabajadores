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

type StatusChoice = "accepted" | "rejected" | "review";

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

function statusPill(s: string) {
  const up = String(s || "").toUpperCase();
  if (up === "ACCEPTED") return { text: "ACEPTADA", bg: "#ecfdf5", bd: "#a7f3d0", fg: "#065f46" };
  if (up === "REJECTED") return { text: "RECHAZADA", bg: "#fff1f2", bd: "#fecdd3", fg: "#9f1239" };
  if (up === "REVIEW") return { text: "EN REVISIÓN", bg: "#fffbeb", bd: "#fde68a", fg: "#92400e" };
  return { text: up || "—", bg: "#f3f4f6", bd: "#e5e7eb", fg: "#111827" };
}

export default function MyInvoicesPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

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

  async function loadMyInvoices(preserveSelectedId?: string | null) {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/invoices/my", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
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

      const keepId = preserveSelectedId || selected?.id || null;
      const keep = keepId ? list.find((x) => x.id === keepId) || null : null;
      setSelected(keep || (list.length ? list[0] : null));
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
      cache: "no-store",
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
    loadMyInvoices(null);
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ invoiceId: selected.id, status: nextStatus, workerNote: note.trim() || null }),
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

      await loadMyInvoices(selected.id);
    } finally {
      setLoading(false);
    }
  }

  async function openPdf() {
    setErr(null);
    if (!selected) return;

    const token = await getToken();
    if (!token) return router.replace("/login");

    const url = `/api/invoices/pdf?invoiceId=${encodeURIComponent(selected.id)}`;
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
    const pill = statusPill(selected.status);
    return {
      month: monthLabel(selected.month_date),
      total: euro(selected.total_eur),
      state: selected.locked_at ? "CERRADA" : "ABIERTA",
      status: pill,
    };
  }, [selected]);

  const shell: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 10px 35px rgba(0,0,0,0.06)",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    fontWeight: 1100,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const btnGhost: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111",
    fontWeight: 1100,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const btnDanger: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid #111",
    background: "#fff",
    color: "#111",
    fontWeight: 1100,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ ...shell, padding: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 1300, lineHeight: 1.1 }}>🧾 Mis facturas</h1>
            <div style={{ color: "#6b7280", fontWeight: 900 }}>
              Revisa tus líneas, descarga PDF y responde si estás de acuerdo.
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => loadMyInvoices(selected?.id || null)} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7 } : btnGhost}>
              {loading ? "Actualizando..." : "Actualizar"}
            </button>

            <a href="/panel" style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              ← Volver
            </a>
          </div>
        </div>
      </div>

      {err ? <div style={{ padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2", color: "#9f1239", fontWeight: 900 }}>{err}</div> : null}

      {/* Mobile: Selector + detalle en una columna */}
      {isMobile ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ ...shell, padding: 14 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 1200 }}>Selecciona factura</div>
              <select
                value={selected?.id || ""}
                onChange={(e) => {
                  const id = e.target.value;
                  const next = invoices.find((x) => x.id === id) || null;
                  setSelected(next);
                }}
                disabled={loading || invoices.length === 0}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  fontWeight: 1100,
                  textTransform: "capitalize",
                  background: "#fff",
                }}
              >
                {invoices.length === 0 ? (
                  <option value="">No hay facturas</option>
                ) : (
                  invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {monthLabel(i.month_date)} · {euro(i.total_eur)}
                    </option>
                  ))
                )}
              </select>

              {selected ? (
                <>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 1300, fontSize: 16, textTransform: "capitalize" }}>{head?.month}</div>
                    <span
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: `1px solid ${head?.status.bd}`,
                        background: head?.status.bg,
                        color: head?.status.fg,
                        fontWeight: 1200,
                        fontSize: 12,
                      }}
                    >
                      {head?.status.text}
                    </span>
                    <span style={{ marginLeft: "auto", color: "#6b7280", fontWeight: 1000 }}>
                      {head?.state} · Total <b style={{ color: "#111" }}>{head?.total}</b>
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
                    <button onClick={openPdf} style={btnPrimary}>
                      Ver PDF
                    </button>
                    <button onClick={() => loadLines(selected.id)} style={btnGhost}>
                      Recargar líneas
                    </button>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 1200, marginBottom: 8 }}>Líneas</div>

                    {lines.length === 0 ? (
                      <div style={{ color: "#6b7280", fontWeight: 900 }}>Sin líneas.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {lines.map((l) => (
                          <div key={l.id} style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                              <div style={{ fontWeight: 1200 }}>{l.label}</div>
                              <div style={{ marginLeft: "auto", fontWeight: 1300 }}>{euro(l.amount_eur)}</div>
                            </div>
                            <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
                              {l.is_manual ? "Manual" : "Automático"} · {String(l.kind || "").toUpperCase()}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                    <div style={{ fontWeight: 1200, marginBottom: 8 }}>Tu respuesta</div>

                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Escribe aquí tu comentario (opcional)"
                      style={{
                        width: "100%",
                        minHeight: 110,
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        outline: "none",
                        fontWeight: 900,
                      }}
                    />

                    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                      <button onClick={() => respond("accepted")} disabled={loading} style={loading ? { ...btnPrimary, opacity: 0.7 } : btnPrimary}>
                        ✅ Aceptar
                      </button>
                      <button onClick={() => respond("review")} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7 } : btnGhost}>
                        🟡 En revisión
                      </button>
                      <button onClick={() => respond("rejected")} disabled={loading} style={loading ? { ...btnDanger, opacity: 0.7 } : btnDanger}>
                        ❌ Rechazar
                      </button>
                    </div>

                    <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 900 }}>
                      {selected.locked_at ? "Esta factura está cerrada. Puedes responder." : "Esta factura está abierta (el admin puede ajustarla)."}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ color: "#6b7280", fontWeight: 900 }}>No hay facturas para mostrar.</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Desktop: 2 columnas pro */
        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12 }}>
          {/* Lista */}
          <div style={{ ...shell, padding: 12 }}>
            <div style={{ fontWeight: 1200, marginBottom: 10 }}>Facturas</div>

            <div style={{ display: "grid", gap: 8, maxHeight: 560, overflow: "auto", paddingRight: 4 }}>
              {invoices.length === 0 ? (
                <div style={{ color: "#6b7280", fontWeight: 900 }}>No hay facturas todavía.</div>
              ) : (
                invoices.map((i) => {
                  const active = selected?.id === i.id;
                  const pill = statusPill(i.status);
                  return (
                    <button
                      key={i.id}
                      onClick={() => setSelected(i)}
                      style={{
                        textAlign: "left",
                        padding: 12,
                        borderRadius: 14,
                        border: active ? "2px solid #111" : "1px solid #e5e7eb",
                        background: active ? "#f8fafc" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 1200, textTransform: "capitalize" }}>{monthLabel(i.month_date)}</div>
                        <span
                          style={{
                            padding: "5px 10px",
                            borderRadius: 999,
                            border: `1px solid ${pill.bd}`,
                            background: pill.bg,
                            color: pill.fg,
                            fontWeight: 1200,
                            fontSize: 12,
                          }}
                        >
                          {pill.text}
                        </span>
                        <div style={{ marginLeft: "auto", fontWeight: 1300 }}>{euro(i.total_eur)}</div>
                      </div>

                      <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 900, fontSize: 13 }}>
                        {i.locked_at ? "CERRADA" : "ABIERTA"} · {String(i.status || "").toUpperCase()}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Detalle */}
          <div style={{ ...shell, padding: 14 }}>
            {!selected ? (
              <div style={{ color: "#6b7280", fontWeight: 900 }}>Selecciona una factura.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 1300, fontSize: 16, textTransform: "capitalize" }}>{head?.month}</div>
                  <span
                    style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${head?.status.bd}`,
                      background: head?.status.bg,
                      color: head?.status.fg,
                      fontWeight: 1200,
                      fontSize: 12,
                    }}
                  >
                    {head?.status.text}
                  </span>
                  <div style={{ marginLeft: "auto", color: "#6b7280", fontWeight: 1000 }}>
                    {head?.state} · Total <b style={{ color: "#111" }}>{head?.total}</b>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={openPdf} style={btnPrimary}>
                    Ver / Descargar PDF
                  </button>

                  <div style={{ color: "#6b7280", display: "flex", alignItems: "center", fontWeight: 900 }}>
                    {selected.locked_at ? "Factura cerrada. Puedes responder." : "Factura abierta (el admin puede ajustarla)."}
                  </div>
                </div>

                <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <div style={{ fontWeight: 1200, marginBottom: 10 }}>Líneas</div>

                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" }}>Concepto</th>
                          <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #e5e7eb" }}>€</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.length === 0 ? (
                          <tr>
                            <td colSpan={2} style={{ padding: 12, color: "#6b7280", fontWeight: 900 }}>
                              Sin líneas.
                            </td>
                          </tr>
                        ) : (
                          lines.map((l) => (
                            <tr key={l.id}>
                              <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", fontWeight: 900 }}>{l.label}</td>
                              <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6", textAlign: "right", fontWeight: 1300 }}>
                                {euro(l.amount_eur)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <div style={{ fontWeight: 1200, marginBottom: 10 }}>Tu respuesta</div>

                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Escribe aquí tu comentario (opcional)"
                    style={{
                      width: "100%",
                      minHeight: 110,
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      outline: "none",
                      fontWeight: 900,
                    }}
                  />

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                    <button onClick={() => respond("accepted")} disabled={loading} style={loading ? { ...btnPrimary, opacity: 0.7 } : btnPrimary}>
                      ✅ Aceptar
                    </button>

                    <button onClick={() => respond("review")} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7 } : btnGhost}>
                      🟡 En revisión
                    </button>

                    <button onClick={() => respond("rejected")} disabled={loading} style={loading ? { ...btnDanger, opacity: 0.7 } : btnDanger}>
                      ❌ Rechazar
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
