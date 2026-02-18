"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type PresenceState = "offline" | "online" | "pause" | "bathroom";
type WorkerRole = "admin" | "central" | "tarotista";

type Row = {
  worker_id: string;
  display_name: string;
  role: WorkerRole;
  state: PresenceState;
  started_at: string | null;
  last_change_at: string | null;
  active_session_id: string | null;
};

type MissingRow = {
  worker_id: string;
  name?: string | null;
  role?: string | null;
  tz?: string | null;
  local_dow?: number | null;
  local_time?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  grace_minutes?: number | null;
};

function fmtAgo(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "hace 0m";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  return `hace ${h}h`;
}

function badge(state: PresenceState) {
  const base: any = {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 900,
    border: "1px solid #ddd",
    fontSize: 12,
  };
  if (state === "online") return <span style={{ ...base, background: "#eaffea" }}>ONLINE</span>;
  if (state === "pause") return <span style={{ ...base, background: "#fff6dd" }}>PAUSA</span>;
  if (state === "bathroom") return <span style={{ ...base, background: "#e8f4ff" }}>BAÑO</span>;
  return <span style={{ ...base, background: "#f4f4f4" }}>OFFLINE</span>;
}

export default function AdminLivePage() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [okAdmin, setOkAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<MissingRow[]>([]);
  const [missingCount, setMissingCount] = useState(0);

  const [filterRole, setFilterRole] = useState<"all" | WorkerRole>("all");
  const [show, setShow] = useState<"online_only" | "all">("all");

  async function ensureAdmin() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }

    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => null);
    if (!j?.ok || !j?.worker) {
      setErr("No tienes perfil en workers.");
      return null;
    }
    if (j.worker.role !== "admin") {
      router.replace("/panel");
      return null;
    }
    setOkAdmin(true);
    return token as string;
  }

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const token = await ensureAdmin();
      if (!token) return;

      const qs = show === "all" ? "?show=all" : "";
      const res = await fetch(`/api/admin/presence/live${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error cargando presencia");
        return;
      }

      // filas presencia
      setRows((j.rows || []).map((r: any) => ({
        worker_id: r.worker_id,
        display_name: r.name ?? r.display_name ?? "—",
        role: r.role,
        state: r.state,
        started_at: r.started_at ?? null,
        last_change_at: r.last_change_at ?? null,
        active_session_id: r.active_session_id ?? null,
      })));

      // faltantes (deberían estar)
      setMissingCount(Number(j.missingCount) || 0);
      setMissing((j.missing || []) as MissingRow[]);
    } catch (e: any) {
      setErr(e?.message || "Error cargando presencia");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const filtered = useMemo(() => {
    let out = rows;
    if (filterRole !== "all") out = out.filter((r) => r.role === filterRole);
    return out;
  }, [rows, filterRole]);

  return (
    <div style={{ padding: 20, maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Directo</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>

        <button onClick={load} disabled={loading} style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <select value={filterRole} onChange={(e) => setFilterRole(e.target.value as any)} style={{ padding: 10, borderRadius: 10 }}>
          <option value="all">Todos</option>
          <option value="central">Centrales</option>
          <option value="tarotista">Tarotistas</option>
        </select>

        <select value={show} onChange={(e) => setShow(e.target.value as any)} style={{ padding: 10, borderRadius: 10 }}>
          <option value="online_only">Solo online/pausa/baño</option>
          <option value="all">Todos (incluye offline)</option>
        </select>

        {okAdmin ? <span style={{ color: "#666" }}>Auto-refresh cada 5s</span> : null}
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

      {/* ✅ NUEVO: Pendientes */}
      <div style={{ border: "2px solid #111", borderRadius: 14, padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 1000, fontSize: 18 }}>🚨 Pendientes ahora</div>
            <div style={{ color: "#666", marginTop: 4 }}>
              Personas que <b>deberían estar en turno</b> y están <b>OFFLINE</b> (según shift_rules).
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 1000 }}>
            {missingCount}
          </div>
        </div>

        {missingCount === 0 ? (
          <div style={{ marginTop: 10, color: "#666" }}>
            No hay pendientes según las reglas actuales.
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Si tú crees que sí debería haber, entonces falta cargar/ajustar <b>shift_rules</b> para esas personas (día/hora/tz).
            </div>
          </div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Persona</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Rol</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>TZ</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Hora local</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Turno</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Gracia</th>
                </tr>
              </thead>
              <tbody>
                {missing.map((m, idx) => (
                  <tr key={`${m.worker_id}-${idx}`}>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", fontWeight: 900 }}>
                      {m.name || m.worker_id.slice(0, 8) + "…"}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{m.role || "—"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", color: "#666" }}>{m.tz || "—"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{m.local_time || "—"}</td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>
                      {m.start_time && m.end_time ? `${m.start_time}–${m.end_time}` : "—"}
                    </td>
                    <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{m.grace_minutes ?? "—"} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tabla presencia */}
      <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Persona</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Rol</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Estado</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Desde</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Último cambio</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 10 }}>Sesión</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: "#666" }}>Sin datos.</td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.worker_id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", fontWeight: 900 }}>{r.display_name}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{r.role}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{badge(r.state)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{r.started_at ? fmtAgo(r.started_at) : "—"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3" }}>{fmtAgo(r.last_change_at)}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f3f3f3", color: "#666" }}>
                    {r.active_session_id ? r.active_session_id.slice(0, 8) + "…" : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

