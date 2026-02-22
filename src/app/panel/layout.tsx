// src/app/panel/layout.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/Badge";

type WorkerRole = "admin" | "central" | "tarotista";
type PresenceState = "offline" | "online" | "pause" | "bathroom";

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

function norm(s: any) {
  return String(s || "").trim().toLowerCase();
}

function formatMonthLabel(isoMonthDate: string) {
  const [y, m] = String(isoMonthDate || "").split("-");
  const monthNum = Number(m);
  const yearNum = Number(y);
  if (!monthNum || !yearNum) return isoMonthDate;

  const date = new Date(yearNum, monthNum - 1, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function formatHMS(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();

  const [name, setName] = useState("");
  const [role, setRole] = useState<WorkerRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);

  // ✅ Header state
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(null);

  const [pState, setPState] = useState<PresenceState>("offline");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const isLoggedPresence = pState !== "offline";

  // === Helpers auth ===
  async function hardLogoutToLogin() {
    try {
      await supabase.auth.signOut();
    } catch {}
    router.replace("/login");
  }

  async function getTokenOrLogout() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token || null;
    if (!token) {
      await hardLogoutToLogin();
      return null;
    }
    return token;
  }

  async function authedFetch(url: string, init?: RequestInit) {
    const token = await getTokenOrLogout();
    if (!token) throw new Error("NO_TOKEN");
    const headers = new Headers(init?.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, { ...init, headers, cache: "no-store" });
  }

  // === Bootstrap: me + months + presence ===
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const token = await getTokenOrLogout();
        if (!token) return;

        const res = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const j = await res.json().catch(() => null);
        if (!alive) return;

        if (!j?.ok || !j?.worker) {
          await hardLogoutToLogin();
          return;
        }

        if (!j.worker.is_active) {
          await hardLogoutToLogin();
          return;
        }

        const r = (j.worker.role as WorkerRole) || null;
        setName(j.worker.display_name || "");
        setRole(r);

        // ✅ months + default month (desde dashboard/full)
        const r2 = await fetch("/api/dashboard/full", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const d = await r2.json().catch(() => null);
        if (alive && d?.ok) {
          const mm = Array.isArray(d.months) ? d.months : [];
          setMonths(mm);
          setMonth(d.month_date || null);
        }

        // ✅ presence si tarotista/central
        if (r === "tarotista" || r === "central") {
          const pr = await fetch("/api/presence/me", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const pj = await pr.json().catch(() => null);
          if (alive && pj?.ok) {
            setPState((pj.state as PresenceState) || "offline");
            setStartedAt(pj.started_at || null);
          }
        }

        if (!alive) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ✅ Tick tiempo
  useEffect(() => {
    let timer: any = null;

    if (!startedAt || pState === "offline") {
      setElapsedSec(0);
      return;
    }

    const startMs = new Date(startedAt).getTime();
    const update = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    update();

    timer = setInterval(update, 1000);
    return () => timer && clearInterval(timer);
  }, [startedAt, pState]);

  // ✅ UI helpers
  const stateTone = pState === "online" ? "ok" : pState === "pause" || pState === "bathroom" ? "warn" : "neutral";
  const stateText = pState === "online" ? "ONLINE" : pState === "pause" ? "PAUSA" : pState === "bathroom" ? "BAÑO" : "OFFLINE";

  const titleRole = role === "admin" ? "Admin" : role === "central" ? "Central" : "Tarotista";

  const canSeeIncidents = role === "tarotista" || role === "central" || role === "admin";

  const linkStyle = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return {
      padding: "10px 14px",
      borderRadius: 999,
      border: active ? "1px solid #111" : "1px solid #e5e7eb",
      background: active ? "#111" : "#fff",
      color: active ? "#fff" : "#111",
      textDecoration: "none",
      fontWeight: 1000 as const,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      whiteSpace: "nowrap" as const,
    };
  };

  async function logout() {
    await hardLogoutToLogin();
  }

  async function refreshAll() {
    // ✅ Simple: recarga la página (mantiene el estado consistente)
    window.location.reload();
  }

  async function changeMonth(next: string) {
    setMonth(next || null);

    // ✅ cambia el query param month_date para que el dashboard lo lea
    // - en /panel → /panel?month_date=YYYY-MM-01
    // - en subrutas igual
    const base = pathname || "/panel";
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("month_date", next);
    else url.searchParams.delete("month_date");
    router.replace(base + "?" + url.searchParams.toString());
  }

  // ✅ Si la URL trae ?month_date=..., reflejarlo en el selector
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("month_date");
      if (q && q !== month) setMonth(q);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const monthLabel = useMemo(() => {
    if (!month) return "—";
    return formatMonthLabel(month);
  }, [month]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            borderRadius: 18,
            border: "1px solid #e5e7eb",
            background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
            boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Image src="/logo.png" alt="Tarot Celestial" width={44} height={44} style={{ borderRadius: 12 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 1200, fontSize: 16 }}>Tarot Celestial</div>
            <div style={{ color: "#6b7280", fontWeight: 900, marginTop: 2 }}>Cargando tu sesión…</div>
            <div style={{ marginTop: 10, height: 8, background: "#eee", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: "55%", height: "100%", background: "#111", borderRadius: 999 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (fatal) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
        <div style={{ width: "100%", maxWidth: 520, border: "2px solid #111", borderRadius: 18, padding: 16, background: "#fff" }}>
          <div style={{ fontWeight: 1100, fontSize: 18 }}>⚠️ No se pudo abrir el panel</div>
          <div style={{ marginTop: 8, color: "#666", fontWeight: 800 }}>{fatal}</div>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <button
              onClick={logout}
              style={{
                padding: 12,
                borderRadius: 12,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 1000,
                cursor: "pointer",
              }}
            >
              Volver a login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ✅ Header PRO
  return (
    <div style={{ minHeight: "100vh", background: "#f6f7fb" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(246,247,251,0.85)", backdropFilter: "blur(10px)", borderBottom: "1px solid #e5e7eb" }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: isMobile ? "10px 10px" : "14px 14px" }}>
          {/* Top row */}
          <div
            style={{
              borderRadius: 20,
              border: "1px solid #e5e7eb",
              background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
              boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
              padding: isMobile ? 12 : 14,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "auto 1fr auto", gap: 12, alignItems: "center" }}>
              {/* Brand */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 14,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    display: "grid",
                    placeItems: "center",
                    overflow: "hidden",
                  }}
                >
                  <Image src="/logo.png" alt="Tarot Celestial" width={46} height={46} />
                </div>

                <div style={{ lineHeight: 1.1 }}>
                  <div style={{ fontWeight: 1300, fontSize: 16 }}>Tarot Celestial</div>
                  <div style={{ color: "#6b7280", fontWeight: 900, marginTop: 4 }}>Panel Interno · Fichaje · Objetivos · Facturación</div>
                </div>
              </div>

              {/* Center: month + status */}
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Badge tone={stateTone as any}>{stateText}</Badge>
                  <div style={{ fontWeight: 1200, fontSize: 18 }}>{formatHMS(elapsedSec)}</div>
                  <div style={{ color: "#6b7280", fontWeight: 900 }}>
                    {titleRole}: <b style={{ color: "#111" }}>{name}</b> · <span style={{ textTransform: "capitalize" }}>{monthLabel}</span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr auto", gap: 10, alignItems: "center" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ color: "#6b7280", fontWeight: 1000, fontSize: 12 }}>Mes</div>
                    <select
                      value={month || ""}
                      onChange={(e) => changeMonth(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: "1px solid #e5e7eb",
                        fontWeight: 900,
                        background: "#fff",
                      }}
                      disabled={months.length === 0}
                    >
                      {months.length === 0 ? <option value="">{month || "—"}</option> : null}
                      {months.map((m) => (
                        <option key={m} value={m}>
                          {formatMonthLabel(m)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={refreshAll}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: "1px solid #111",
                      background: "#111",
                      color: "#fff",
                      fontWeight: 1100,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      height: 46,
                      alignSelf: isMobile ? "stretch" : "end",
                    }}
                    title="Actualizar datos"
                  >
                    Actualizar
                  </button>
                </div>
              </div>

              {/* Right: actions */}
              <div style={{ display: "flex", gap: 10, justifyContent: isMobile ? "space-between" : "flex-end", alignItems: "center" }}>
                {role === "admin" ? (
                  <a href="/admin" style={{ ...linkStyle("/admin"), borderRadius: 14 }}>
                    Ir a Admin →
                  </a>
                ) : null}

                <button
                  onClick={logout}
                  style={{
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    color: "#111",
                    fontWeight: 1100,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Cerrar sesión
                </button>
              </div>
            </div>

            {/* Nav pills */}
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "nowrap",
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                paddingBottom: 2,
              }}
            >
              <a href="/panel" style={linkStyle("/panel")}>
                📊 Dashboard
              </a>
              <a href="/panel/invoices" style={linkStyle("/panel/invoices")}>
                🧾 Facturas
              </a>
              {canSeeIncidents ? (
                <a href="/panel/incidents" style={linkStyle("/panel/incidents")}>
                  ⚠️ Mis incidencias
                </a>
              ) : (
                <span style={{ ...linkStyle("/panel/incidents"), opacity: 0.4, pointerEvents: "none" }}>⚠️ Mis incidencias</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: isMobile ? "12px 10px" : "16px 14px" }}>{children}</div>
    </div>
  );
}
