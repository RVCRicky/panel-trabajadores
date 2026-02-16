"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type WorkerRow = {
  id: string;
  display_name: string;
  role: string;
};

export default function AdminInvoicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [workerId, setWorkerId] = useState<string>("");
  const [monthDate, setMonthDate] = useState<string>("2026-02-01");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function getToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadWorkers() {
    setErr(null);
    setOkMsg(null);
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      // Reutilizamos el endpoint dashboard/full porque ya nos dice si eres admin
      const res = await fetch("/api/dashboard/full", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error dashboard");
        return;
      }
      if (!j?.user?.isAdmin) {
        setErr("No eres admin.");
        return;
      }

      // Sacar workers directamente con Service en API sería lo ideal,
      // pero para ir rápido lo pedimos a Supabase desde cliente (solo lectura).
      // Como esto es admin, te vale.
      const { data: w, error } = await supabase
        .from("workers")
        .select("id, display_name, role")
        .order("role", { ascending: true })
        .order("display_name", { ascending: true });

      if (error) {
        setErr(error.message);
        return;
      }

      const list = (w || []) as WorkerRow[];
      setWorkers(list);

      if (!workerId && list.length) setWorkerId(list[0].id);
    } catch (e: any) {
      setErr(e?.message || "Error cargando workers");
    } finally {
      setLoading(false);
    }
  }

  async function upload() {
    setErr(null);
    setOkMsg(null);

    if (!workerId) {
      setErr("Elige un trabajador.");
      return;
    }
    if (!monthDate || !monthDate.match(/^\d{4}-\d{2}-01$/)) {
      setErr("Mes inválido. Formato: YYYY-MM-01 (ej: 2026-02-01)");
      return;
    }
    if (!file) {
      setErr("Selecciona un PDF.");
      return;
    }
    if (file.type !== "application/pdf") {
      setErr("El archivo debe ser PDF.");
      return;
    }

    setUploading(true);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/login");
        return;
      }

      const form = new FormData();
      form.append("worker_id", workerId);
      form.append("month_date", monthDate);
      form.append("file", file);

      const res = await fetch("/api/admin/upload-invoice", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || `Error (${res.status})`);
        return;
      }

      setOkMsg("✅ Factura subida correctamente.");
      setFile(null);

      // limpiar input file visualmente: forzamos re-render cambiando key
      const input = document.getElementById("pdfInput") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (e: any) {
      setErr(e?.message || "Error subiendo factura");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    loadWorkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Subir facturas</h1>

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

        <button
          onClick={loadWorkers}
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            fontWeight: 800,
          }}
        >
          {loading ? "Cargando..." : "Recargar workers"}
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

      {okMsg ? (
        <div
          style={{
            padding: 10,
            border: "1px solid #ccffcc",
            background: "#f3fff3",
            borderRadius: 10,
            marginBottom: 12,
          }}
        >
          {okMsg}
        </div>
      ) : null}

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ color: "#666", marginBottom: 6 }}>Trabajador</div>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", minWidth: 260 }}
            >
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.display_name} ({w.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ color: "#666", marginBottom: 6 }}>Mes (YYYY-MM-01)</div>
            <input
              value={monthDate}
              onChange={(e) => setMonthDate(e.target.value)}
              placeholder="2026-02-01"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", width: 160 }}
            />
          </div>

          <div>
            <div style={{ color: "#666", marginBottom: 6 }}>PDF</div>
            <input
              id="pdfInput"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <div style={{ alignSelf: "end" }}>
            <button
              onClick={upload}
              disabled={uploading}
              style={{
                padding: 10,
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 800,
              }}
            >
              {uploading ? "Subiendo..." : "Subir factura"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, color: "#666", fontSize: 12 }}>
          Se guarda en Storage bucket <b>invoices</b> (privado) y crea una fila en tabla <b>invoices</b> con status{" "}
          <b>pending</b>.
        </div>
      </div>

      <div style={{ marginTop: 12, color: "#666", fontSize: 12 }}>
        Después de subir, el trabajador la verá en: <b>/panel/invoices</b>
      </div>
    </div>
  );
}
