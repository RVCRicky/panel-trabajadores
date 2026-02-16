"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

type MeResp =
  | { ok: true; userId: string; worker: null }
  | { ok: true; userId: string; worker: { id: string; role: "admin" | "central" | "tarotista"; display_name: string; is_active: boolean } }
  | { ok: false; error: string };

export default function PanelPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Cargando...");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session?.access_token) {
        router.replace("/login");
        return;
      }

      setStatus("Detectando tu rol...");

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      const json = (await res.json()) as MeResp;

      if (!json || (json as any).ok === false) {
        setStatus("Error leyendo tu perfil. Ve a Supabase y crea tu worker.");
        return;
      }

      if (json.worker === null) {
        setStatus("No tienes perfil creado en workers. (Admin debe crear tu ficha)");
        return;
      }

      if (!json.worker.is_active) {
        setStatus("Tu usuario está desactivado.");
        return;
      }

      if (json.worker.role === "admin") router.replace("/admin");
      else if (json.worker.role === "central") router.replace("/central");
      else router.replace("/tarotista");
    })();
  }, [router]);

  return (
    <div style={{ minHeight: "70vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 18, maxWidth: 520, width: "100%" }}>
        <b>{status}</b>
        <p style={{ color: "#666", marginTop: 8 }}>
          Si se queda aquí, dime el mensaje exacto que ves y lo arreglamos.
        </p>
      </div>
    </div>
  );
}
