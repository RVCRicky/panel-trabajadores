"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

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

export default function AdminPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Cargando...");
  const [name, setName] = useState<string>("");
  const [role, setRole] = useState<string>("");

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

      setName(json.worker.display_name);
      setRole(json.worker.role);
      setStatus("OK");
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ padding: 18 }}>
      <h1 style={{ marginTop: 0 }}>Admin</h1>

      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, maxWidth: 520 }}>
        <p style={{ margin: 0 }}>
          Estado: <b>{status}</b>
        </p>
        {status === "OK" ? (
          <>
            <p style={{ marginTop: 10, marginBottom: 0 }}>
              Bienvenido: <b>{name}</b>
            </p>
            <p style={{ marginTop: 6, color: "#666" }}>
              Rol: <b>{role}</b>
            </p>
          </>
        ) : null}
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          onClick={logout}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600
          }}
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
