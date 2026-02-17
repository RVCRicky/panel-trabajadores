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
  const [filterRole, setFilterRole] = useState<"all" | WorkerRole>("all");

  // ✅ NUEVO: filtro de visibilidad (por defecto solo activos)
  const [showMode, setShowMode] = useState<"active" | "all">("active");

  async function ensureAdmin() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return false;
    }

    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    const j = await res.json().catch(() => null);
    if (!j?.ok || !j?.worker) {
      setErr("No tienes perfil en workers.");
      return false;
    }
    if (j.worker.role !== "admin") {
      router.replace("/panel");
      return false;
    }
    setOkAdmin(true);
    return true;
  }

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const ok = await ensureAdmin();
      if (!ok) return;

      // presence_current + workers
      const { data: cur, error: e1 } = await supabase
        .from("presence_current")
        .select("worker_id,state,active_session_id,last_change_at");
      if (e1) throw e1;

      const { data: ws, error: e2 } = await supabase
        .from("workers")
        .select("id,display_name,role,is_active")
        .eq("is_active", true);
      if (e2) throw e2;

      // sessions abiertas para started_at
      const { data: ses, error: e3 } = await supabase
        .from("presence_sessions")
        .select("id,worker_id,started_at,ended_at")
        .is("ended_at", null);
      if (e3) throw e3;

      const curByWorker = new Map<string, any>();
      for (const c of cur || []) curByWorker.set(c.worker_id, c);

      const openSesByWorker = new Map<string, any>();
      for (const s of ses || []) {
        // si hay varias, nos quedamos con la más reciente
        const prev = openSesByWorker.get(s.worker_id);
        if (!prev || new Date(s.started_at).getTime() > new Date(prev.started_at).getTime()) {
          openSesByWorker.set(s.worker_id, s);
        }
      }

      const out: Row[] = (ws || [])
        .filter((w: any) => w.role === "central" || w.role === "tarotista")
        .map((w: any) => {
          const c = curByWorker.get(w.id) || null;
          const s = openSesByWorker.get(w.id) || null;
          const state: PresenceState = (c?.state as PresenceState) || (s ? "online" : "offline");
          return {
            worker_id: w.id,
            display_name: w.display_name,
            role: w.role,
            state: state === "offline" && s ? "online" : state,
            started_at: s?.started_at || null,
            last_change_at: c?.last_change_at || null,
            active_session_id: c?.active_session_id || s?.id || null,
          };
        });

      // orden: online primero, luego pause, baño, offline + nombre
      const orderKey = (st: PresenceState) => (st === "online" ? 0 : st === "pause" ? 1 : st === "bathroom" ? 2 : 3);
      out.sort((a, b) => {
        const d = orderKey(a.state) - orderKey(b.state);
        if (d !== 0) return d;
        return a.display_name.localeCompare(b.display_name);
      });

      setRows(out);
    } catch (e: any) {
      setErr(e?.message || "Error cargando presencia");
    } finally {
      setLoading(false);
    }
  }

  // auto refresh
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let list = rows;

    // ✅ filtro por rol
    if (filterRole !== "all") list = list.filter((r) => r.role === filterRole);

    // ✅ filtro por estado (por defecto: solo activos)
    if (showMode === "active") {
      list = list.filter((r) => r.state !== "offline");
    }

    return list;
  }, [rows, filterRole, showMode]);

  return (
    <div style={{ padding: 20, maxWidth: 1100 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Directo</h1>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>

        <button
          onClick={load}
          disabled={loading}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
        >
          {loading ? "Actualizando..." : "Actualizar"}
        </button>

        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value as any)}
          style={{ padding: 10, borderRadius: 10 }}
        >
          <option value="all">Todos</option>
          <option value="central">Centrales</option>
          <option value="tarotista">Tarotistas</option>
        </select>

        {/* ✅ NUEVO: solo activos / todos */}
        <select
          value={showMode}
          onChange={(e) => setShowMode(e.target.value as any)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
        >
          <option value="active">Solo activos (online/pausa/baño)</option>
          <option value="all">Todos (incluye offline)</option>
        </select>

        {okAdmin ? <span style={{ color: "#666", alignSelf: "center" }}>Auto-refresh cada 5s</span> : null}
      </div>

      {err ? (
        <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 10, marginBottom: 12 }}>
          {err}
        </div>
      ) : null}

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
                <td colSpan={6} style={{ padding: 12, color: "#666" }}>
                  {showMode === "active" ? "No hay nadie activo ahora mismo." : "Sin datos."}
                </td>
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

