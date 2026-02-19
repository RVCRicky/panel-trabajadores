"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type WorkerRole = "admin" | "central" | "tarotista";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

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

      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => null);

      if (!j?.ok || !j?.worker) {
        router.replace("/login");
        return;
      }

      if (!j.worker.is_active) {
        router.replace("/login");
        return;
      }

      // ✅ IMPORTANTE: NO redirigimos a admin. Admin puede ver /panel.
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

  const linkStyle = (href: string) => ({
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    textDecoration: "none",
    fontWeight: 900 as const,
    background: pathname === href ? "#111" : "#fff",
    color: pathname === href ? "#fff" : "#111",
  });

  return (
    <div>
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
          <div style={{ fontWeight: 1000, letterSpacing: 0.2 }}>Tarot Celestial · Panel</div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "#666" }}>
              {role ? (
                <>
                  {role === "admin" ? "Admin" : role === "central" ? "Central" : "Tarotista"}:{" "}
                  <b style={{ color: "#111" }}>{name}</b>
                </>
              ) : (
                <>
                  Usuario: <b style={{ color: "#111" }}>{name}</b>
                </>
              )}
            </span>

            {/* ✅ SOLO si es admin mostramos botón para ir a Admin */}
            {role === "admin" ? (
              <a href="/admin" style={{ ...linkStyle("/admin"), fontWeight: 900 }}>
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

        {/* Menu Panel */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 14px 14px", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href="/panel" style={linkStyle("/panel")}>
            Dashboard
          </a>
          <a href="/panel/invoices" style={linkStyle("/panel/invoices")}>
            Facturas
          </a>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 14 }}>{children}</div>
    </div>
  );
}
