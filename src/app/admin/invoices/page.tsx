"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Invoice = {
  id: string;
  worker_id: string;
  month_date: string;
  status: string;
  base_salary_eur: number;
  bonuses_eur: number;
  penalties_eur: number;
  total_eur: number;
  worker_note: string | null;
  admin_note: string | null;
  locked_at: string | null;
  worker: { display_name: string } | null;
};

type Line = {
  id: string;
  invoice_id: string;
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

export default function AdminInvoicesPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<Line[]>([]);

  // formulario extra/sanción
  const [lineLabel, setLineLabel] = useState("");
  const [lineAmount, setLineAmount] = useState<string>("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // ✅ check admin via /api/me
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => null);

      if (!json?.ok) return setStatus(`Error /api/me: ${json?.error || "UNKNOWN"}`);
      if (!json.worker) return setStatus("No tienes perfil en workers.");
      if (!json.worker.is_active) return setStatus("Usuario desactivado.");
      if (json.worker.role !== "admin") return router.replace("/panel");

      setMeName(json.worker.display_name);
      setStatus("OK");
    })();
  }, [router]);

  async function loadInvoices() {
    setErr(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/admin/invoices/list", {
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

      // mantener seleccionado si existe
      if (selectedInvoice) {
        const again = list.find((x) => x.id === selectedInvoice.id) || null;
        setSelectedInvoice(again || (list.length ? list[0] : null));
      } else {
        if (list.length) setSelectedInvoice(list[0]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadLines(invoiceId: string) {
    setErr(null);
    setLines([]);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch(`/api/admin/invoices/lines?invoiceId=${encodeURIComponent(invoiceId)}`, {
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
    } catch (e: any) {
      setErr(e?.message || "Error cargando líneas");
    }
  }

  useEffect(() => {
    if (status !== "OK") return;
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (!selectedInvoice) return;
    loadLines(selectedInvoice.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInvoice?.id]);

  async function addManualLine() {
    setErr(null);
    if (!selectedInvoice) return;

    if (selectedInvoice.locked_at) {
      setErr("Esta factura está CERRADA. Reábrela para poder modificarla.");
      return;
    }

    const amount = Number(String(lineAmount).replace(",", "."));
    if (!lineLabel.trim() || !Number.isFinite(amount)) {
      setErr("Rellena concepto y amount (número). Para sanción usa negativo, ej: -20");
      return;
    }

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/admin/invoices/add-line", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          label: lineLabel.trim(),
          amountEur: amount,
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

      setLineLabel("");
      setLineAmount("");

      await loadInvoices();
      await loadLines(selectedInvoice.id);
    } finally {
      setLoading(false);
    }
  }

  async function toggleLock(lock: boolean) {
    setErr(null);
    if (!selectedInvoice) return;

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/admin/invoices/lock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          lock,
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

      await loadInvoices();
      await loadLines(selectedInvoice.id);
    } finally {
      setLoading(false);
    }
  }

  const selectedInfo = useMemo(() => {
    if (!selectedInvoice) return null;
    return {
      who: selectedInvoice.worker?.display_name || selectedInvoice.worker_id,
      month: selectedInvoice.month_date,
      status: selectedInvoice.status,
      total: euro(selectedInvoice.total_eur),
      locked: !!selectedInvoice.locked_at,
    };
  }, [selectedInvoice]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Admin · Facturas</h1>

        <span style={{ marginLeft: "auto", color: "#666" }}>
          Estado: <b style={{ color: "#111" }}>{status}</b>
          {status === "OK" ? (
            <>
              {" "}
              · Admin: <b style={{ color: "#111" }}>{meName}</b>
            </>
          ) : null}
        </span>

        <button
          onClick={loadInvoices}
          disabled={loading || status !== "OK"}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900, cursor: "pointer" }}
        >
          {loading ? "Cargando..." : "Actualizar"}
        </button>

        <button
          onClick={logout}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Cerrar sesión
        </button>
      </div>

      {err ? <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10 }}>{err}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 12 }}>
        {/* Lista facturas */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Facturas</div>

          <div style={{ display: "grid", gap: 8, maxHeight: 520, overflow: "auto" }}>
            {invoices.length === 0 ? (
              <div style={{ color: "#666" }}>No hay facturas.</div>
            ) : (
              invoices.map((i) => {
                const active = selectedInvoice?.id === i.id;
                const locked = !!i.locked_at;
                return (
                  <button
                    key={i.id}
                    onClick={() => setSelectedInvoice(i)}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderRadius: 12,
                      border: active ? "2px solid #111" : "1px solid #ddd",
                      background: active ? "#f6f6f6" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{i.worker?.display_name || "—"}</div>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      {i.month_date} · {locked ? "CERRADA" : "ABIERTA"} · {i.status} ·{" "}
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
          {!selectedInvoice ? (
            <div style={{ color: "#666" }}>Selecciona una factura.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>
                  {selectedInfo?.who} · {selectedInfo?.month}
                </div>
                <div style={{ marginLeft: "auto", color: "#666" }}>
                  Estado: <b style={{ color: "#111" }}>{selectedInfo?.status}</b> · Total:{" "}
                  <b style={{ color: "#111" }}>{selectedInfo?.total}</b>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                {selectedInvoice.locked_at ? (
                  <button
                    onClick={() => toggleLock(false)}
                    disabled={loading}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900, cursor: "pointer" }}
                  >
                    Reabrir factura
                  </button>
                ) : (
                  <button
                    onClick={() => toggleLock(true)}
                    disabled={loading}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #111",
                      background: "#111",
                      color: "#fff",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Cerrar factura
                  </button>
                )}

                <div style={{ color: "#666", display: "flex", alignItems: "center" }}>
                  Esta factura está:{" "}
                  <b style={{ color: "#111", marginLeft: 6 }}>{selectedInvoice.locked_at ? "CERRADA" : "ABIERTA"}</b>
                </div>
              </div>

              <div style={{ marginTop: 10, borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Líneas</div>

                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Concepto</th>
                      <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>€</th>
                      <th style={{ textAlign: "center", padding: 8, borderBottom: "1px solid #eee" }}>Manual</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ padding: 10, color: "#666" }}>
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
                          <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "center" }}>
                            {l.is_manual ? "✅" : ""}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 10, opacity: selectedInvoice.locked_at ? 0.6 : 1 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Añadir extra / sanción (manual)</div>

                {selectedInvoice.locked_at ? (
                  <div style={{ color: "#666" }}>Factura cerrada: reábrela para añadir extras/sanciones.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    <input
                      value={lineLabel}
                      onChange={(e) => setLineLabel(e.target.value)}
                      placeholder="Ej: Extra productividad / Sanción incidencia"
                      style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                    />
                    <input
                      value={lineAmount}
                      onChange={(e) => setLineAmount(e.target.value)}
                      placeholder="Ej: 50 (extra) o -20 (sanción)"
                      style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
                    />

                    <button
                      onClick={addManualLine}
                      disabled={loading}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        border: "1px solid #111",
                        background: "#111",
                        color: "#fff",
                        fontWeight: 900,
                        cursor: "pointer",
                      }}
                    >
                      {loading ? "Guardando..." : "Añadir línea y recalcular"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none", width: "fit-content" }}>
        ← Volver a Admin
      </a>
    </div>
  );
}
