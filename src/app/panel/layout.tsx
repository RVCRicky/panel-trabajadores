"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type WorkerRole = "admin" | "central" | "tarotista";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [name, setName] = useState<string>("");
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

      // Si es admin, lo mandamos al admin panel (para no mezclar)
      if (j.worker.role === "admin") {
        router.replace("/admin");
        return;
      }

      setName(j.worker.display_name || "");
      setRole(j.worker.role);
      setLoading(false);
    })();
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#666" }}>
        Cargando…
      </div>
    );
  }

  const linkStyle = (href: string) => ({
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    textDecoration: "none",
    fontWeight: 800,
    background: pathname === href ? "#111" : "#fff",
    color: pathname === href ? "#fff" : "#111",
  });

  return (
    <div>
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "#fff",
          borderBottom: "1px solid #eee",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 1000, letterSpacing: 0.2 }}>Tarot Celestial · Panel</div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "#666" }}>
              {name} · <b style={{ color: "#111" }}>{role}</b>
            </span>

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

        {/* Menu */}
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
