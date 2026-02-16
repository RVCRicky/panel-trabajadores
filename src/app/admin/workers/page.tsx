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

export default function AdminWorkersPage() {
  const router = useRouter();

  const [status, setStatus] = useState("Cargando...");
  const [meName, setMeName] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<WorkerRole>("tarotista");
  const [displayName, setDisplayName] = useState("");
  const [externalRef, setExternalRef] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

      setMeName(json.worker.display_name);
      setStatus("OK");
    })();
  }, [router]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const e2 = email.trim().toLowerCase();
    if (!e2 || !password || !displayName.trim()) {
      setMsg("Rellena email, password y nombre.");
      return;
    }

    setSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const r = await fetch("/api/admin/create-worker", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: e2,
          password,
          role,
          display_name: displayName.trim(),
          external_ref: externalRef.trim() || null,
        }),
      });

      // 🔥 IMPORTANTE: no asumimos JSON. Leemos texto primero.
      const raw = await r.text();

      let j: any = null;
      try {
        j = raw ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }

      if (!r.ok) {
        setMsg(`Error HTTP ${r.status}. Respuesta: ${raw || "(vacía)"}`);
        return;
      }

      if (!j?.ok) {
        setMsg(`Error: ${j?.error || raw || "UNKNOWN"}`);
        return;
      }

      setMsg(`✅ Creado: ${e2} (user_id: ${j.user_id})`);
      setEmail("");
      setPassword("");
      setDisplayName("");
      setExternalRef("");
      setRole("tarotista");
    } catch (err: any) {
      setMsg(err?.message || "Error inesperado");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ padding: 18, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Admin · Trabajadores</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <p style={{ margin: 0 }}>
          Estado: <b>{status}</b>
        </p>
        {status === "OK" ? (
          <p style={{ marginTop: 8, color: "#666" }}>
            Admin: <b>{meName}</b>
          </p>
        ) : null}
      </div>

      <div style={{ marginTop: 14, border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Crear trabajador</h2>

        <form onSubmit={onCreate} style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="persona@correo.com"
              required
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="text"
              placeholder="contraseña temporal"
              required
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Nombre a mostrar</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              type="text"
              placeholder="Ej: África"
              required
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Rol</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkerRole)}
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            >
              <option value="tarotista">Tarotista</option>
              <option value="central">Central</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>External Ref (para casar con Google Sheets)</span>
            <input
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              type="text"
              placeholder="Ej: africa / ext-101 / lo-que-uséis"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
            />
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
              marginTop: 6,
            }}
          >
            {saving ? "Creando..." : "Crear trabajador"}
          </button>

          {msg ? (
            <div style={{ padding: 10, borderRadius: 10, background: "#f6f6f6", border: "1px solid #e5e5e5" }}>
              {msg}
            </div>
          ) : null}
        </form>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
        <a href="/admin" style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", textDecoration: "none" }}>
          ← Volver a Admin
        </a>

        <button
          onClick={logout}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
