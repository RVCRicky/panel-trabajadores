// src/app/panel/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type WorkerRole = "admin" | "central" | "tarotista";

type MeOk = {
  ok: true;
  userId?: string;
  worker: null | {
    id: string;
    role: WorkerRole;
    display_name: string;
    is_active: boolean;
  };
};

type MeErr = { ok: false; error: string };
type MeResp = MeOk | MeErr;

export default function PanelEntry() {
  const router = useRouter();
  const qs = useSearchParams();

  const [msg, setMsg] = useState("Abriendo tu panel…");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token || null;

        if (!token) {
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const j = (await res.json().catch(() => null)) as MeResp | null;
        if (!alive) return;

        if (!j?.ok) {
          setMsg(`Error /api/me: ${(j as any)?.error || "UNKNOWN"}`);
          return;
        }

        if (!j.worker) {
          setMsg("No tienes perfil en workers.");
          return;
        }

        if (!j.worker.is_active) {
          setMsg("Usuario desactivado.");
          return;
        }

        // mantener month_date si viene en la URL
        const month = qs.get("month_date");
        const q = month ? `?month_date=${encodeURIComponent(month)}` : "";

        const role = String(j.worker.role || "").toLowerCase();

        if (role === "admin") {
          // ✅ admin estable (tu dashboard actual)
          router.replace(`/admin${q}`);
          return;
        }

        if (role === "central") {
          router.replace(`/panel/central${q}`);
          return;
        }

        // ✅ tarotista -> su panel real
        router.replace(`/panel/tarotista${q}`);
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message || "Error abriendo el panel.");
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, qs]);

  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
      <div style={{ fontWeight: 1200, color: "#6b7280" }}>{msg}</div>
    </div>
  );
}
