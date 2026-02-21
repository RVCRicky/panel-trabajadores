// src/app/panel/layout.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type WorkerRole = "admin" | "central" | "tarotista";

function useIsMobile(bp = 720) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [bp]);

  return isMobile;
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  const [name, setName] = useState("");
  const [role, setRole] = useState<WorkerRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => null);

      if (!j?.ok || !j?.worker) {
        router.replace("/login");
        return;
      }

      if (!j.worker.is_active) {
        router.replace("/login");
        return;
      }

      setName(j.worker.display_name || "");
      setRole((j.worker.role as WorkerRole) || null);
      setLoading(false);
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#666" }}>Cargando…</div>;
  }

  const linkStyle = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #ddd",
      textDecoration: "none",
      fontWeight: 900 as const,
      background: active ? "#111" : "#fff",
      color: active ? "#fff" : "#111",
      whiteSpace: "nowrap" as const,
      flex: "0 0 auto",
    };
  };

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", borderBottom: "1px solid #eee" }}>
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: isMobile ? 10 : 14,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 1000, letterSpacing: 0.2 }}>Tarot Celestial · Panel</div>

          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
              width: isMobile ? "100%" : "auto",
              justifyContent: isMobile ? "space-between" : "flex-end",
            }}
          >
            <span style={{ color: "#666", fontSize: isMobile ? 12 : 14 }}>
              {role === "admin" ? "Admin" : role === "central" ? "Central" : "Tarotista"}:{" "}
              <b style={{ color: "#111" }}>{name}</b>
            </span>

            {role === "admin" ? (
              <a href="/admin" style={linkStyle("/admin")}>
                Ir a Admin →
              </a>
            ) : null}

            <button
              onClick={logout}
              style={{
                padding: "10px 12px",
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
        </div>

        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: isMobile ? "0 10px 10px" : "0 14px 14px",
            display: "flex",
            gap: 10,
            flexWrap: "nowrap",
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <a href="/panel" style={linkStyle("/panel")}>
            Dashboard
          </a>
          <a href="/panel/invoices" style={linkStyle("/panel/invoices")}>
            Facturas
          </a>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: isMobile ? 10 : 14, width: "100%" }}>{children}</div>
    </div>
  );
}
