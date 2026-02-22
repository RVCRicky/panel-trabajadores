"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/Badge";

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

function statusPill(statusRaw: any) {
  const s = String(statusRaw || "").toLowerCase();

  // tonos aproximados (Badge ya maneja estilos por tone)
  if (s === "accepted") return { text: "ACEPTADA", tone: "ok" as any };
  if (s === "rejected") return { text: "RECHAZADA", tone: "bad" as any };
  if (s === "review" || s === "in_review") return { text: "EN REVISIÓN", tone: "warn" as any };

  if (!s) return { text: "—", tone: "neutral" as any };
  return { text: s.toUpperCase(), tone: "neutral" as any };
}

export default function MyInvoicesPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(false);
  const [loadingLines, setLoadingLines] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadMyInvoices(keepSelectedId?: string | null) {
    setErr(null);
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/invoices/my", {
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

      const list: Invoice[] = Array.isArray(j.invoices) ? j.invoices : [];
      setInvoices(list);

      const targetId = keepSelectedId ?? selected?.id ?? null;
      const nextSelected =
        (targetId ? list.find((x) => x.id === targetId) : null) || (list.length ? list[0] : null);

      setSelected(nextSelected);
    } finally {
      setLoading(false);
    }
  }

  async function loadLines(invoiceId: string) {
    setErr(null);
    setLoadingLines(true);
    setLines([]);

    try {
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

      setLines(Array.isArray(j.lines) ? j.lines : []);
    } finally {
      setLoadingLines(false);
    }
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

      // ✅ recarga y mantiene seleccionada esta misma
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

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
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

  const selectedMeta = useMemo(() => {
    if (!selected) return null;
    const st = statusPill(selected.status);
    return {
      month: monthLabel(selected.month_date),
      total: euro(selected.total_eur),
      statusText: st.text,
      statusTone: st.tone,
      locked: !!selected.locked_at,
    };
  }, [selected]);

  const totals = useMemo(() => {
    const total = (invoices || []).reduce((acc, x) => acc + (Number(x.total_eur) || 0), 0);
    const closed = (invoices || []).filter((x) => !!x.locked_at).length;
    const open = (invoices || []).length - closed;
    return { total, closed, open, count: (invoices || []).length };
  }, [invoices]);

  const card: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
  };

  const btnBase: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111",
    fontWeight: 1100,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
  };

  const btnGhost: React.CSSProperties = {
    ...btnBase,
  };

  const splitCols = isMobile ? "1fr" : "380px 1fr";

  return (
    <div style={{ display: "grid", gap: 14, width: "100%", maxWidth: 1160 }}>
      {/* Header */}
      <div style={{ ...card, padding: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
            gap: 12,
            alignItems: "center",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 1300, fontSize: 20, lineHeight: 1.1 }}>🧾 Mis facturas</div>
            <div style={{ color: "#6b7280", fontWeight: 900 }}>
              Aquí ves tus facturas mensuales, sus líneas y puedes responder al admin.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
            <button onClick={() => loadMyInvoices(selected?.id || null)} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}>
              {loading ? "Actualizando…" : "Actualizar"}
            </button>

            <button onClick={openPdf} disabled={!selected || loading} style={!selected || loading ? { ...btnGhost, opacity: 0.6, cursor: "not-allowed" } : btnGhost}>
              Ver PDF
            </button>

            <a href="/panel" style={{ ...btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              ← Volver
            </a>
          </div>
        </div>

        {/* Mini resumen */}
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
            <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Total facturas</div>
            <div style={{ fontWeight: 1300, fontSize: 18, marginTop: 4 }}>{totals.count}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
            <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Abiertas</div>
            <div style={{ fontWeight: 1300, fontSize: 18, marginTop: 4 }}>{totals.open}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
            <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Cerradas</div>
            <div style={{ fontWeight: 1300, fontSize: 18, marginTop: 4 }}>{totals.closed}</div>
          </div>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
            <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Suma total</div>
            <div style={{ fontWeight: 1300, fontSize: 18, marginTop: 4 }}>{euro(totals.total)}</div>
          </div>
        </div>
      </div>

      {err ? (
        <div style={{ padding: 12, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 14, fontWeight: 900 }}>
          {err}
        </div>
      ) : null}

      {/* Body */}
      <div style={{ display: "grid", gridTemplateColumns: splitCols, gap: 12, alignItems: "start" }}>
        {/* List */}
        <div style={{ ...card, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 1200, fontSize: 14, color: "#111" }}>Facturas</div>
            <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
              {loading ? "Cargando…" : invoices.length ? `${invoices.length} meses` : "—"}
            </div>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 10, maxHeight: isMobile ? 360 : 560, overflow: "auto", paddingRight: 4 }}>
            {loading && invoices.length === 0 ? (
              <div style={{ color: "#6b7280", fontWeight: 900 }}>Cargando facturas…</div>
            ) : invoices.length === 0 ? (
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
                      borderRadius: 16,
                      border: active ? "2px solid #111" : "1px solid #e5e7eb",
                      background: active ? "linear-gradient(180deg, #ffffff 0%, #f7f7f7 100%)" : "#fff",
                      cursor: "pointer",
                      boxShadow: active ? "0 10px 35px rgba(0,0,0,0.10)" : "none",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 1300, textTransform: "capitalize" }}>{monthLabel(i.month_date)}</div>
                      <div style={{ fontWeight: 1300 }}>{euro(i.total_eur)}</div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Badge tone={i.locked_at ? ("neutral" as any) : ("warn" as any)}>{i.locked_at ? "CERRADA" : "ABIERTA"}</Badge>
                      <Badge tone={pill.tone}>{pill.text}</Badge>
                      {i.admin_note ? (
                        <span style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>💬 Nota admin</span>
                      ) : null}
                      {i.worker_note ? (
                        <span style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>📝 Tu nota</span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detail */}
        <div style={{ ...card, padding: 12 }}>
          {!selected ? (
            <div style={{ color: "#6b7280", fontWeight: 900 }}>Selecciona una factura.</div>
          ) : (
            <>
              {/* Detail header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 1400, fontSize: 18, textTransform: "capitalize" }}>{selectedMeta?.month}</div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Badge tone={selectedMeta?.locked ? ("neutral" as any) : ("warn" as any)}>{selectedMeta?.locked ? "CERRADA" : "ABIERTA"}</Badge>
                    <Badge tone={selectedMeta?.statusTone as any}>{selectedMeta?.statusText}</Badge>
                    <span style={{ color: "#6b7280", fontWeight: 900 }}>
                      Total: <b style={{ color: "#111" }}>{selectedMeta?.total}</b>
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                  <button onClick={openPdf} style={btnGhost}>
                    Ver / Descargar PDF
                  </button>
                </div>
              </div>

              {/* Notes */}
              {(selected.admin_note || selected.worker_note) ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {selected.admin_note ? (
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
                      <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Nota del admin</div>
                      <div style={{ marginTop: 6, fontWeight: 900, whiteSpace: "pre-wrap" }}>{selected.admin_note}</div>
                    </div>
                  ) : null}

                  {selected.worker_note ? (
                    <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, background: "#fff" }}>
                      <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Tu nota actual</div>
                      <div style={{ marginTop: 6, fontWeight: 900, whiteSpace: "pre-wrap" }}>{selected.worker_note}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Lines */}
              <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 1200 }}>Líneas</div>
                  <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
                    {loadingLines ? "Cargando…" : lines.length ? `${lines.length} líneas` : "—"}
                  </div>
                </div>

                <div style={{ marginTop: 10, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e5e7eb" }}>Concepto</th>
                        <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #e5e7eb" }}>€</th>
                      </tr>
                    </thead>

                    <tbody>
                      {loadingLines ? (
                        <tr>
                          <td colSpan={2} style={{ padding: 12, color: "#6b7280", fontWeight: 900 }}>
                            Cargando líneas…
                          </td>
                        </tr>
                      ) : lines.length === 0 ? (
                        <tr>
                          <td colSpan={2} style={{ padding: 12, color: "#6b7280", fontWeight: 900 }}>
                            Sin líneas.
                          </td>
                        </tr>
                      ) : (
                        lines.map((l) => {
                          const isNeg = (Number(l.amount_eur) || 0) < 0;
                          return (
                            <tr key={l.id}>
                              <td style={{ padding: 10, borderBottom: "1px solid #f3f4f6" }}>
                                <div style={{ fontWeight: 1000 }}>{l.label}</div>
                                <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12, marginTop: 4 }}>
                                  {l.is_manual ? "Manual" : "Automático"} · {String(l.kind || "").toUpperCase()}
                                </div>
                              </td>
                              <td
                                style={{
                                  padding: 10,
                                  borderBottom: "1px solid #f3f4f6",
                                  textAlign: "right",
                                  fontWeight: 1200,
                                  color: isNeg ? "#b91c1c" : "#111",
                                }}
                              >
                                {euro(l.amount_eur)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>

                    <tfoot>
                      <tr>
                        <td style={{ padding: 10, borderTop: "1px solid #e5e7eb", fontWeight: 1200 }}>Total</td>
                        <td style={{ padding: 10, borderTop: "1px solid #e5e7eb", textAlign: "right", fontWeight: 1400 }}>
                          {euro(selected.total_eur)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Reply */}
              <div style={{ marginTop: 16, borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                <div style={{ fontWeight: 1200 }}>Tu respuesta</div>
                <div style={{ color: "#6b7280", fontWeight: 900, marginTop: 4 }}>
                  Puedes añadir una nota opcional y marcar el estado.
                </div>

                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Escribe aquí tu comentario si quieres (opcional)"
                  style={{
                    width: "100%",
                    minHeight: 96,
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    outline: "none",
                    fontWeight: 900,
                    background: "#fff",
                  }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button onClick={() => respond("accepted")} disabled={loading} style={loading ? { ...btnPrimary, opacity: 0.7, cursor: "not-allowed" } : btnPrimary}>
                    ✅ Aceptar
                  </button>

                  <button onClick={() => respond("review")} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}>
                    🟡 En revisión
                  </button>

                  <button onClick={() => respond("rejected")} disabled={loading} style={loading ? { ...btnGhost, opacity: 0.7, cursor: "not-allowed" } : btnGhost}>
                    ❌ Rechazar
                  </button>

                  <div style={{ marginLeft: "auto", color: "#6b7280", fontWeight: 900, display: "flex", alignItems: "center" }}>
                    {selected.locked_at ? "Factura cerrada." : "Factura abierta (puede cambiar)."}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
