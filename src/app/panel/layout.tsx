// src/app/panel/layout.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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

function roleLabel(role: WorkerRole | null) {
  if (role === "admin") return "Admin";
  if (role === "central") return "Central";
  if (role === "tarotista") return "Tarotista";
  return "—";
}

function roleTone(role: WorkerRole | null) {
  // solo visual
  if (role === "admin") return { bg: "#111", fg: "#fff", bd: "#111" };
  if (role === "central") return { bg: "#fff", fg: "#111", bd: "#111" };
  if (role === "tarotista") return { bg: "#fff", fg: "#111", bd: "#e5e7eb" };
  return { bg: "#fff", fg: "#111", bd: "#e5e7eb" };
}

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "TC";
  return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  const [name, setName] = useState("");
  const [role, setRole] = useState<WorkerRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          if (!alive) return;
          router.replace("/login");
          return;
        }

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = await res.json().catch(() => null);

        if (!alive) return;

        if (!j?.ok || !j?.worker) {
          // ✅ cortamos loops: cerramos sesión si el worker no se puede validar
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        if (!j.worker.is_active) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }

        setName(j.worker.display_name || "");
        setRole((j.worker.role as WorkerRole) || null);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setFatal(e?.message || "Error cargando tu sesión. Vuelve a iniciar sesión.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const nav = useMemo(() => {
    // ✅ Siempre 2 botones base (los 3 los ponemos cuando exista /panel/incidents)
    // Si ya tienes /panel/incidents, lo puedes activar abajo (ya lo dejo incluido).
    const items = [
      { href: "/panel", label: "Dashboard", icon: "📊" },
      { href: "/panel/invoices", label: "Facturas", icon: "🧾" },
      { href: "/panel/incidents", label: "Mis incidencias", icon: "⚠️" },
    ];
    return items;
  }, []);

  const tone = roleTone(role);

  const pill = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 999,
    border: active ? "1px solid #111" : "1px solid #e5e7eb",
    background: active ? "#111" : "rgba(255,255,255,0.92)",
    color: active ? "#fff" : "#111",
    textDecoration: "none",
    fontWeight: 1000,
    whiteSpace: "nowrap",
    boxShadow: active ? "0 10px 24px rgba(0,0,0,0.18)" : "0 6px 16px rgba(0,0,0,0.06)",
    transform: active ? "translateY(-1px)" : "translateY(0px)",
    transition: "transform 140ms ease, box-shadow 140ms ease, background 140ms ease",
  });

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 16,
          background:
            "radial-gradient(900px 500px at 20% 20%, rgba(17,17,17,0.10) 0%, rgba(255,255,255,0) 60%), linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
          color: "#111",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            border: "2px solid #111",
            borderRadius: 20,
            padding: 16,
            background: "rgba(255,255,255,0.86)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ fontWeight: 1200, fontSize: 18 }}>Tarot Celestial</div>
          <div style={{ marginTop: 6, color: "#6b7280", fontWeight: 900 }}>
            Cargando tu sesión…
          </div>
          <div
            style={{
              marginTop: 14,
              height: 10,
              borderRadius: 999,
              background: "#eee",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "45%",
                height: "100%",
                borderRadius: 999,
                background: "#111",
                animation: "tc_bar 900ms ease-in-out infinite alternate",
              }}
            />
          </div>

          <style>{`
            @keyframes tc_bar {
              from { transform: translateX(-10%); opacity: .75; }
              to   { transform: translateX(120%); opacity: 1; }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (fatal) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 16,
          background:
            "radial-gradient(900px 500px at 20% 20%, rgba(185,28,28,0.10) 0%, rgba(255,255,255,0) 60%), linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 560,
            border: "2px solid #111",
            borderRadius: 20,
            padding: 16,
            background: "rgba(255,255,255,0.92)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.10)",
          }}
        >
          <div style={{ fontWeight: 1200, fontSize: 18 }}>⚠️ No se pudo abrir el panel</div>
          <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 900, whiteSpace: "pre-wrap" }}>{fatal}</div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <button
              onClick={logout}
              style={{
                padding: 12,
                borderRadius: 14,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 1100,
                cursor: "pointer",
                boxShadow: "0 14px 30px rgba(0,0,0,0.18)",
              }}
            >
              Volver a login
            </button>
          </div>
        </div>
      </div>
    );
  }

  const brandBar: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 50,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    background: "rgba(255,255,255,0.78)",
    borderBottom: "1px solid rgba(17,17,17,0.08)",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(900px 500px at 10% 0%, rgba(17,17,17,0.10) 0%, rgba(255,255,255,0) 60%), linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
      }}
    >
      {/* ===== HEADER WOW ===== */}
      <div style={brandBar}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: isMobile ? "12px 12px" : "16px 16px" }}>
          <div
            style={{
              border: "1px solid rgba(17,17,17,0.10)",
              borderRadius: 22,
              padding: isMobile ? 12 : 14,
              background: "rgba(255,255,255,0.72)",
              boxShadow: "0 16px 34px rgba(0,0,0,0.08)",
            }}
          >
            {/* Top row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
                gap: 12,
                alignItems: "center",
              }}
            >
              {/* Brand */}
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    border: "1px solid rgba(17,17,17,0.15)",
                    background: "linear-gradient(180deg, rgba(17,17,17,0.08) 0%, rgba(17,17,17,0.02) 100%)",
                    display: "grid",
                    placeItems: "center",
                    boxShadow: "0 14px 26px rgba(0,0,0,0.10)",
                    fontWeight: 1200,
                  }}
                  title="Tarot Celestial"
                >
                  ✨
                </div>

                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 1300, letterSpacing: -0.2, fontSize: 18 }}>
                      Tarot Celestial
                    </div>

                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: `1px solid ${tone.bd}`,
                        background: tone.bg,
                        color: tone.fg,
                        fontWeight: 1100,
                        fontSize: 12,
                      }}
                    >
                      {roleLabel(role)}
                    </span>
                  </div>

                  <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 13 }}>
                    Panel Interno · Fichaje · Objetivos · Facturación
                  </div>
                </div>
              </div>

              {/* User & actions */}
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  justifyContent: isMobile ? "space-between" : "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 999,
                      border: "1px solid rgba(17,17,17,0.15)",
                      background: "rgba(255,255,255,0.9)",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 1200,
                      boxShadow: "0 12px 22px rgba(0,0,0,0.08)",
                    }}
                    title={name || "Usuario"}
                  >
                    {initials(name)}
                  </div>

                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontWeight: 1200, fontSize: 14, lineHeight: 1.1 }}>
                      {name || "—"}
                    </div>
                    <div style={{ color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
                      Sesión activa
                    </div>
                  </div>
                </div>

                {role === "admin" ? (
                  <a
                    href="/admin"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: "1px solid rgba(17,17,17,0.18)",
                      background: "rgba(255,255,255,0.92)",
                      color: "#111",
                      textDecoration: "none",
                      fontWeight: 1100,
                      boxShadow: "0 12px 22px rgba(0,0,0,0.08)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    🛠️ Admin
                  </a>
                ) : null}

                <button
                  onClick={logout}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid #111",
                    background: "#111",
                    color: "#fff",
                    fontWeight: 1100,
                    cursor: "pointer",
                    boxShadow: "0 14px 30px rgba(0,0,0,0.16)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Cerrar sesión
                </button>
              </div>
            </div>

            {/* Nav row */}
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "nowrap", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              {nav.map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                return (
                  <a key={it.href} href={it.href} style={pill(active)} aria-current={active ? "page" : undefined}>
                    <span style={{ fontSize: 16 }}>{it.icon}</span>
                    <span>{it.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ===== CONTENT ===== */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: isMobile ? 12 : 16, width: "100%" }}>
        {children}
      </div>
    </div>
  );
}
