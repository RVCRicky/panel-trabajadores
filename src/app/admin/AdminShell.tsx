"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => null);

      if (!j?.ok || !j?.worker) {
        router.replace("/login");
        return;
      }

      if (j.worker.role !== "admin") {
        router.replace("/panel");
        return;
      }

      setName(j.worker.display_name || "");
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

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  };

  const linkStyle = (href: string) => {
    const active = isActive(href);
    return {
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #ddd",
      textDecoration: "none",
      fontWeight: 900,
      background: active ? "#111" : "#fff",
      color: active ? "#fff" : "#111",
      whiteSpace: "nowrap",
      flex: "0 0 auto",
    } as React.CSSProperties;
  };

  return (
    <div style={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", borderBottom: "1px solid #eee" }}>
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: 14,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 1000, letterSpacing: 0.2 }}>Tarot Celestial · Admin</div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "#666" }}>
              Admin: <b style={{ color: "#111" }}>{name}</b>
            </span>

            <a href="/panel" style={linkStyle("/panel")}>
              Ir al Panel →
            </a>

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
                whiteSpace: "nowrap",
              }}
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        {/* Menu (scroll horizontal en móvil) */}
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "0 14px 14px",
            display: "flex",
            gap: 10,
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          <a href="/admin" style={linkStyle("/admin")}>
            Dashboard
          </a>
          <a href="/admin/live" style={linkStyle("/admin/live")}>
            Presencia
          </a>
          <a href="/admin/incidents" style={linkStyle("/admin/incidents")}>
            Incidencias
          </a>
          <a href="/admin/workers" style={linkStyle("/admin/workers")}>
            Trabajadores
          </a>
          <a href="/admin/mappings" style={linkStyle("/admin/mappings")}>
            Mappings
          </a>
        </div>
      </div>

      {/* Content */}
      <div style={{ width: "100%", maxWidth: 1100, margin: "0 auto", padding: 14 }}>
        {children}
      </div>
    </div>
  );
}
