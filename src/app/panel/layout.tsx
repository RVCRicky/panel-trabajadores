// src/app/panel/layout.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "TC";
  return parts.map((p) => (p[0] ? p[0].toUpperCase() : "")).join("");
}

function rolePillStyle(role: WorkerRole | null): { bg: string; fg: string; bd: string } {
  if (role === "admin") return { bg: "#111", fg: "#fff", bd: "#111" };
  if (role === "central") return { bg: "rgba(255,255,255,0.92)", fg: "#111", bd: "rgba(17,17,17,0.22)" };
  if (role === "tarotista") return { bg: "rgba(255,255,255,0.92)", fg: "#111", bd: "rgba(17,17,17,0.14)" };
  return { bg: "rgba(255,255,255,0.92)", fg: "#111", bd: "rgba(17,17,17,0.14)" };
}

function LogoMark({ size = 40 }: { size?: number }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: Math.max(12, Math.floor(size * 0.35)),
          display: "grid",
          placeItems: "center",
          fontWeight: 1400,
          background: "#111",
          color: "#fff",
          letterSpacing: -0.2,
        }}
      >
        TC
      </div>
    );
  }

  return (
    <Image
      src="/logo.png"
      alt="Tarot Celestial"
      width={size}
      height={size}
      priority
      onError={() => setBroken(true)}
      style={{ objectFit: "contain" }}
    />
  );
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
          // cortamos cualquier loop de sesión corrupta
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
        setFatal(e?.message || "No se pudo cargar tu sesión. Vuelve a iniciar sesión.");
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
    return [
      { href: "/panel", label: "Dashboard", icon: "📊" },
      { href: "/panel/invoices", label: "Facturas", icon: "🧾" },
      { href: "/panel/incidents", label: "Mis incidencias", icon: "⚠️" },
    ];
  }, []);

  const bg: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(900px 520px at 12% 0%, rgba(17,17,17,0.12) 0%, rgba(255,255,255,0) 62%), radial-gradient(900px 520px at 92% 10%, rgba(17,17,17,0.06) 0%, rgba(255,255,255,0) 55%), linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)",
  };

  const pill = rolePillStyle(role);

  const navPill = (active: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: isMobile ? "10px 14px" : "10px 16px",
    borderRadius: 999,
    border: active ? "1px solid #111" : "1px solid rgba(17,17,17,0.12)",
    background: active ? "#111" : "rgba(255,255,255,0.92)",
    color: active ? "#fff" : "#111",
    textDecoration: "none",
    fontWeight: 1200,
    whiteSpace: "nowrap",
    boxShadow: active ? "0 16px 34px rgba(0,0,0,0.18)" : "0 12px 26px rgba(0,0,0,0.08)",
    transform: active ? "translateY(-1px)" : "translateY(0px)",
    transition: "transform 140ms ease, box-shadow 140ms ease, background 140ms ease",
  });

  const cardShell: React.CSSProperties = {
    borderRadius: 26,
    border: "1px solid rgba(17,17,17,0.10)",
    background: "rgba(255,255,255,0.74)",
    boxShadow: "0 22px 60px rgba(0,0,0,0.10)",
  };

  if (loading) {
    return (
      <div style={{ ...bg, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 560, ...cardShell, padding: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 16,
                border: "1px solid rgba(17,17,17,0.12)",
                background: "rgba(255,255,255,0.92)",
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
                boxShadow: "0 14px 26px rgba(0,0,0,0.10)",
              }}
            >
              <LogoMark size={40} />
            </div>

            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontWeight: 1400, letterSpacing: -0.2, fontSize: 18 }}>Tarot Celestial</div>
              <div style={{ color: "#6b7280", fontWeight: 950, fontSize: 13 }}>Cargando tu sesión…</div>
            </div>
          </div>

          <div style={{ marginTop: 14, height: 10, borderRadius: 999, background: "#eee", overflow: "hidden" }}>
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

          <div style={{ marginTop: 10, color: "#6b7280", fontWeight: 900, fontSize: 12 }}>
            Si tarda mucho, revisa tu conexión o vuelve a iniciar sesión.
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
      <div style={{ ...bg, display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 600, ...cardShell, padding: 16 }}>
          <div style={{ fontWeight: 1400, fontSize: 18 }}>⚠️ No se pudo abrir el panel</div>
          <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 950, whiteSpace: "pre-wrap" }}>{fatal}</div>

          <button
            onClick={logout}
            style={{
              marginTop: 14,
              width: "100%",
              padding: 12,
              borderRadius: 14,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              fontWeight: 1300,
              cursor: "pointer",
              boxShadow: "0 16px 34px rgba(0,0,0,0.18)",
            }}
          >
            Volver a login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={bg}>
      {/* HEADER GLASS */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          background: "rgba(255,255,255,0.72)",
          borderBottom: "1px solid rgba(17,17,17,0.08)",
        }}
      >
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: isMobile ? 12 : 16 }}>
          <div style={{ ...cardShell, padding: isMobile ? 12 : 14 }}>
            {/* TOP ROW */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
                gap: 12,
                alignItems: "center",
              }}
            >
              {/* BRAND */}
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 16,
                    border: "1px solid rgba(17,17,17,0.12)",
                    background: "rgba(255,255,255,0.92)",
                    display: "grid",
                    placeItems: "center",
                    boxShadow: "0 14px 26px rgba(0,0,0,0.10)",
                    overflow: "hidden",
                  }}
                  title="Tarot Celestial"
                >
                  <LogoMark size={40} />
                </div>

                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 1500, letterSpacing: -0.25, fontSize: 18 }}>Tarot Celestial</div>

                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: `1px solid ${pill.bd}`,
                        background: pill.bg,
                        color: pill.fg,
                        fontWeight: 1300,
                        fontSize: 12,
                      }}
                    >
                      {roleLabel(role)}
                    </span>
                  </div>

                  <div style={{ color: "#6b7280", fontWeight: 950, fontSize: 13 }}>
                    Panel Interno · Fichaje · Objetivos · Facturación
                  </div>
                </div>
              </div>

              {/* USER + ACTIONS */}
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
                      width: 42,
                      height: 42,
                      borderRadius: 999,
                      border: "1px solid rgba(17,17,17,0.14)",
                      background: "rgba(255,255,255,0.92)",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 1400,
                      boxShadow: "0 12px 22px rgba(0,0,0,0.08)",
                    }}
                    title={name || "Usuario"}
                  >
                    {initials(name)}
                  </div>

                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontWeight: 1400, fontSize: 14, lineHeight: 1.1 }}>{name || "—"}</div>
                    <div style={{ color: "#6b7280", fontWeight: 950, fontSize: 12 }}>Sesión activa</div>
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
                      fontWeight: 1300,
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
                    fontWeight: 1300,
                    cursor: "pointer",
                    boxShadow: "0 16px 34px rgba(0,0,0,0.18)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Cerrar sesión
                </button>
              </div>
            </div>

            {/* NAV ROW */}
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "nowrap", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              {nav.map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                return (
                  <a key={it.href} href={it.href} style={navPill(active)} aria-current={active ? "page" : undefined}>
                    <span style={{ fontSize: 16 }}>{it.icon}</span>
                    <span>{it.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: isMobile ? 12 : 16, width: "100%" }}>{children}</div>
    </div>
  );
}
