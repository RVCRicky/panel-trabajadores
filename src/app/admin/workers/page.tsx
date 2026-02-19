// src/app/admin/workers/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

type WorkerRow = {
  id: string; // normalmente = auth.users.id
  name: string;
  role: WorkerRole;
  is_active: boolean;
};

export default function AdminWorkersPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  // LISTADO trabajadores
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [workersErr, setWorkersErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // ACTUALIZAR credenciales
  const [targetWorkerId, setTargetWorkerId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  // comprobar admin
  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const json = (await res.json().catch(() => null)) as MeResp | null;

      if (!json?.ok) return setStatus(`Error /api/me: ${(json as any)?.error || "UNKNOWN"}`);
      if (!json.worker) return setStatus("No tienes perfil en workers.");
      if (!json.worker.is_active) return setStatus("Usuario desactivado.");
      if (json.worker.role !== "admin") return router.replace("/panel");

      setMeName(json.worker.display_name);
      setStatus("OK");
    })();
  }, [router]);

  async function loadWorkers() {
    setWorkersErr(null);
    setLoadingWorkers(true);
    try {
      // ✅ TU TABLA REAL ES "workers"
      const { data, error } = await supabase
        .from("workers")
        .select("id,name,role,is_active")
        .order("name", { ascending: true });

      if (error) {
        setWorkersErr(error.message);
        return;
      }

      setWorkers((data as any[]) as WorkerRow[]);
    } finally {
      setLoadingWorkers(false);
    }
  }

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return workers;
    return workers.filter((w) => (w.name || "").toLowerCase().includes(t));
  }, [workers, q]);

  async function onUpdateCredentials(e: React.FormEvent) {
    e.preventDefault();
    setUpdateMsg(null);

    const wid = targetWorkerId.trim();
    const e2 = newEmail.trim().toLowerCase();
    const p2 = newPassword;

    if (!wid) return setUpdateMsg("Selecciona un trabajador (o pega el UUID).");
    if (!e2 && !p2) return setUpdateMsg("Pon email y/o contraseña.");

    setUpdating(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const r = await fetch("/api/admin/workers/credentials", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workerId: wid,
          email: e2 || null,
          password: p2 || null,
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
        setUpdateMsg(`Error HTTP ${r.status}. ${j?.error || raw || "UNKNOWN"}`);
        return;
      }

      setUpdateMsg("✅ Credenciales actualizadas");
      setNewPassword("");
    } catch (err: any) {
      setUpdateMsg(err?.message || "Error inesperado");
    } finally {
      setUpdating(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ padding: 18, maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Admin · Trabajadores</h1>

        <div style={{ marginLeft: "auto", color: "#666" }}>
          Estado: <b style={{ color: "#111" }}>{status}</b>
          {status === "OK" ? (
            <>
              {" "}
              · Admin: <b style={{ color: "#111" }}>{meName}</b>
            </>
          ) : null}
        </div>

        <button
          onClick={logout}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 900,
          }}
        >
          Cerrar sesión
        </button>
      </div>

      {/* LISTA */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Seleccionar trabajador</h2>

          <button
            onClick={loadWorkers}
            disabled={loadingWorkers || status !== "OK"}
            style={{
              padding: 10,
              borderRadius: 10,
              border: "1px solid #111",
              background: loadingWorkers ? "#eee" : "#fff",
              cursor: loadingWorkers ? "not-allowed" : "pointer",
              fontWeight: 900,
            }}
          >
            {loadingWorkers ? "Cargando..." : "Cargar trabajadores"}
          </button>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre..."
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc", minWidth: 240 }}
          />

          <div style={{ marginLeft: "auto", color: "#666" }}>
            {workers.length ? (
              <>
                Total: <b style={{ color: "#111" }}>{workers.length}</b>
              </>
            ) : (
              "—"
            )}
          </div>
        </div>

        {workersErr ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "#fff3f3", border: "1px solid #ffcccc" }}>
            {workersErr}
          </div>
        ) : null}

        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Nombre</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Rol</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>Activo</th>
                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>UUID</th>
                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 10, color: "#666" }}>
                    {workers.length === 0 ? "Pulsa “Cargar trabajadores”." : "Sin resultados."}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 50).map((w) => (
                  <tr key={w.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{w.name}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{w.role}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3" }}>{w.is_active ? "sí" : "no"}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", fontFamily: "monospace", fontSize: 12 }}>{w.id}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f3f3", textAlign: "right" }}>
                      <button
                        onClick={() => {
                          setTargetWorkerId(w.id);
                          setUpdateMsg(null);
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #111",
                          background: "#111",
                          color: "#fff",
                          cursor: "pointer",
                          fontWeight: 900,
                        }}
                      >
                        Usar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {filtered.length > 50 ? <div style={{ marginTop: 8, color: "#666" }}>Mostrando 50 resultados (refina la búsqueda).</div> : null}
        </div>
      </div>

      {/* CAMBIAR CREDENCIALES */}
      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Cambiar email / contraseña</h2>

        <form onSubmit={onUpdateCredentials} style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Worker UUID (auth.users.id)</span>
            <input
              value={targetWorkerId}
              onChange={(e) => setTargetWorkerId(e.target.value)}
              type="text"
              placeholder="Selecciona uno arriba o pega el UUID"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Nuevo email (opcional)</span>
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              type="email"
              placeholder="nuevo@correo.com"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Nueva contraseña (opcional)</span>
            <input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type="text"
              placeholder="nueva contraseña"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <button
            type="submit"
            disabled={updating || status !== "OK" || !targetWorkerId.trim() || (!newEmail.trim() && !newPassword)}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid #111",
              background: updating ? "#eee" : "#111",
              color: updating ? "#111" : "#fff",
              cursor: updating ? "not-allowed" : "pointer",
              fontWeight: 900,
              marginTop: 6,
            }}
          >
            {updating ? "Actualizando..." : "Actualizar credenciales"}
          </button>

          {updateMsg ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#f6f6f6", border: "1px solid #e5e5e5" }}>
              {updateMsg}
            </div>
          ) : null}
        </form>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>
      </div>
    </div>
  );
}
