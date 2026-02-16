"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

type WorkerRole = "admin" | "central" | "tarotista";

type MeOk = {
  ok: true;
  userId: string;
  worker: null | {
    id: string;
    role: WorkerRole;
    display_name: string;
    is_active: boolean;
  };
};
type MeErr = { ok: false; error: string };
type MeResp = MeOk | MeErr;

type TarotistWorker = { id: string; display_name: string; external_ref: string | null };

type MappingRow = {
  id: number;
  csv_tarotista: string;
  worker_id: string;
  created_at: string;
  worker: { id: string; display_name: string } | null;
};

export default function AdminMappingsPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [msg, setMsg] = useState<string | null>(null);

  const [csvTarotista, setCsvTarotista] = useState(""); // Call111
  const [workerId, setWorkerId] = useState("");

  const [tarotistas, setTarotistas] = useState<TarotistWorker[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session?.access_token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = (await res.json()) as MeResp;

      if (!json.ok) {
        setStatus(`Error /api/me: ${json.error}`);
        return;
      }
      if (!json.worker) {
        setStatus("No tienes perfil en workers.");
        return;
      }
      if (!json.worker.is_active) {
        setStatus("Usuario desactivado.");
        return;
      }
      if (json.worker.role !== "admin") {
        router.replace("/panel");
        return;
      }

      setStatus("OK");
      await refreshAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function refreshAll() {
    setLoading(true);
    setMsg(null);
    try {
      // Lista de tarotistas
      const { data: t, error: tErr } = await supabase
        .from("workers")
        .select("id, display_name, external_ref, role")
        .eq("role", "tarotista")
        .order("display_name", { ascending: true });

      if (tErr) {
        setMsg(`Error workers: ${tErr.message}`);
        return;
      }

      setTarotistas(((t as any) || []).map((x: any) => ({
        id: x.id,
        display_name: x.display_name,
        external_ref: x.external_ref ?? null
      })));

      // Lista mappings
      const { data: m, error: mErr } = await supabase
        .from("call_mappings")
        .select("id, csv_tarotista, worker_id, created_at, worker:workers(id, display_name)")
        .order("csv_tarotista", { ascending: true });

      if (mErr) {
        setMsg(`Error call_mappings: ${mErr.message}`);
        return;
      }

      setMappings((m as any) || []);
    } finally {
      setLoading(false);
    }
  }

  async function addMapping(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const key = csvTarotista.trim();
    if (!key || !workerId) {
      setMsg("Rellena Call### y elige una tarotista.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from("call_mappings").upsert(
        {
          csv_tarotista: key,
          worker_id: workerId,
        },
        { onConflict: "csv_tarotista" }
      );

      if (error) {
        setMsg(`Error guardando mapping: ${error.message}`);
        return;
      }

      setMsg(`✅ Mapping guardado: ${key} → ${tarotistas.find(t => t.id === workerId)?.display_name || workerId}`);
      setCsvTarotista("");
      setWorkerId("");
      await refreshAll();
    } finally {
      setSaving(false);
    }
  }

  async function deleteMapping(id: number) {
    if (!confirm("¿Borrar este mapping?")) return;
    setMsg(null);
    try {
      const { error } = await supabase.from("call_mappings").delete().eq("id", id);
      if (error) {
        setMsg(`Error borrando: ${error.message}`);
        return;
      }
      await refreshAll();
    } catch (e: any) {
      setMsg(e?.message || "Error inesperado");
    }
  }

  return (
    <div style={{ padding: 18, maxWidth: 980 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Mappings (Call### → Tarotista)</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        Estado: <b>{status}</b>
        {loading ? <span style={{ marginLeft: 10, color: "#666" }}>Cargando...</span> : null}
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Crear / Actualizar mapping</h2>

        <form onSubmit={addMapping} style={{ display: "grid", gap: 10, maxWidth: 520 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Valor en CSV (columna TAROTISTA)</span>
            <input
              value={csvTarotista}
              onChange={(e) => setCsvTarotista(e.target.value)}
              placeholder="Ej: Call111"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Tarotista real (workers)</span>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            >
              <option value="">-- Elige tarotista --</option>
              {tarotistas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.display_name}
                  {t.external_ref ? ` (ext_ref: ${t.external_ref})` : ""}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={saving || status !== "OK"}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #111",
              background: saving ? "#eee" : "#111",
              color: saving ? "#111" : "#fff",
              cursor: saving ? "not-allowed" : "pointer",
              fontWeight: 700,
              width: 260,
            }}
          >
            {saving ? "Guardando..." : "Guardar mapping"}
          </button>
        </form>

        {msg ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 10, background: "#f6f6f6", border: "1px solid #e5e5e5" }}>
            {msg}
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Mappings actuales</h2>

        {mappings.length === 0 ? (
          <p style={{ color: "#666" }}>Aún no hay mappings. Crea el primero: Call111 → (tarotista).</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>CSV TAROTISTA</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tarotista</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Creado</th>
                  <th style={{ borderBottom: "1px solid #eee", padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{m.csv_tarotista}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>
                      {m.worker?.display_name || m.worker_id}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", color: "#666" }}>
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                      <button
                        onClick={() => deleteMapping(m.id)}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        Borrar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>
        <button
          onClick={refreshAll}
          disabled={loading}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Recargar
        </button>
      </div>
    </div>
  );
}
