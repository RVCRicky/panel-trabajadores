// src/app/panel/layout.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/Badge";

type WorkerRole = "admin" | "central" | "tarotista";
type PresenceState = "offline" | "online" | "pause" | "bathroom";

function useIsMobile(bp = 900) {
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

  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(null);

  const [pState, setPState] = useState<PresenceState>("offline");
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

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

  // Bootstrap
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const token = await getTokenOrLogout();
        if (!token) return;

        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const meJson = await meRes.json().catch(() => null);
        if (!alive) return;

        if (!meJson?.ok || !meJson?.worker) {
          await hardLogoutToLogin();
          return;
        }
        if (!meJson.worker.is_active) {
          await hardLogoutToLogin();
          return;
        }

        const r = (meJson.worker.role as WorkerRole) || null;
        setName(meJson.worker.display_name || "");
        setRole(r);

        // months + month_date (para el selector del header)
        const dashRes = await fetch("/api/dashboard/full", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const dashJson = await dashRes.json().catch(() => null);
        if (alive && dashJson?.ok) {
          setMonths(Array.isArray(dashJson.months) ? dashJson.months : []);
          setMonth(dashJson.month_date || null);
        }

        // presence (solo tarotista/central)
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

  // Tick
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

  const stateTone = pState === "online" ? "ok" : pState === "pause" || pState === "bathroom" ? "warn" : "neutral";
  const stateText = pState === "online" ? "ONLINE" : pState === "pause" ? "PAUSA" : pState === "bathroom" ? "BAÑO" : "OFFLINE";

  const titleRole = role === "admin" ? "Admin" : role === "central" ? "Central" : "Tarotista";
  const canSeeIncidents = role === "tarotista" || role === "central" || role === "admin";

  async function logout() {
    await hardLogoutToLogin();
  }

  function refreshAll() {
    // recarga simple y segura (mismo estado)
    window.location.reload();
  }

  function changeMonth(next: string) {
    setMonth(next || null);

    const base = pathname || "/panel";
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("month_date", next);
    else url.searchParams.delete("month_date");

    const qs = url.searchParams.toString();
    router.replace(qs ? `${base}?${qs}` : base);
  }

  // Si URL trae month_date, reflejarlo
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const q = u.searchParams.get("month_date");
      if (q && q !== month) setMonth(q);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const monthLabel = useMemo(() => (month ? formatMonthLabel(month) : "—"), [month]);

  const pill = (href: string, emoji: string, text: string) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <a
        href={href}
        style={{
          padding: "10px 14px",
          borderRadius: 999,
          border: active ? "1px solid #111" : "1px solid #e5e7eb",
          background: active ? "#111" : "#fff",
          color: active ? "#fff" : "#111",
          textDecoration: "none",
          fontWeight: 1100,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          whiteSpace: "nowrap",
          flex: "0 0 auto",
        }}
      >
        <span>{emoji}</span>
        <span>{text}</span>
      </a>
    );
  };

  const shellCard: React.CSSProperties = {
    borderRadius: 22,
    border: "1px solid #e5e7eb",
    background: "linear-gradient(180deg, #ffffff 0%, #fafafa 100%)",
    boxShadow: "0 12px 45px rgba(0,0,0,0.08)",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid #111",
    background: "#111",
    color: "#fff",
    fontWeight: 1200,
    cursor: "pointer",
    whiteSpace: "nowrap",
    height: 42,
  };

  const btnGhost: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#111",
    fontWeight: 1200,
    cursor: "pointer",
    whiteSpace: "nowrap",
    height: 42,
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f7fb" }}>
        <div style={{ width: "100%", maxWidth: 520, ...shellCard, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          {/* Loader: unoptimized + priority para que no “falle” en build/blur */}
          <Image src="/logo.png" alt="Tarot Celestial" width={44} height={44} style={{ borderRadius: 12 }} priority unoptimized />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 1300, fontSize: 16 }}>Tarot Celestial</div>
            <div style={{ color: "#6b7280", fontWeight: 1000, marginTop: 2 }}>Cargando tu sesión…</div>
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
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#f6f7fb" }}>
        <div style={{ width: "100%", maxWidth: 520, border: "2px solid #111", borderRadius: 18, padding: 16, background: "#fff" }}>
          <div style={{ fontWeight: 1200, fontSize: 18 }}>⚠️ No se pudo abrir el panel</div>
          <div style={{ marginTop: 8, color: "#6b7280", fontWeight: 900 }}>{fatal}</div>
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <button onClick={logout} style={btnPrimary}>
              Volver a login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f6f7fb" }}>
      {/* Sticky header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(246,247,251,0.86)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: isMobile ? "10px 10px" : "14px 14px" }}>
          <div style={{ ...shellCard, padding: isMobile ? 12 : 14, display: "grid", gap: 12 }}>
            {/* Row A (mobile-first) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "auto 1fr auto",
                gap: 12,
                alignItems: "center",
              }}
            >
              {/* Brand */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
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
                    flex: "0 0 auto",
                  }}
                >
                  <Image src="/logo.png" alt="Tarot Celestial" width={46} height={46} priority />
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 1400, fontSize: 16, lineHeight: 1.1 }}>Tarot Celestial</div>
                  <div style={{ color: "#6b7280", fontWeight: 1000, marginTop: 4, lineHeight: 1.2 }}>
                    {titleRole}: <b style={{ color: "#111" }}>{name}</b>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: isMobile ? "flex-start" : "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <Badge tone={stateTone as any}>{stateText}</Badge>
                <div style={{ fontWeight: 1400, fontSize: 18 }}>{formatHMS(elapsedSec)}</div>
                {!isMobile ? <div style={{ color: "#6b7280", fontWeight: 1000, textTransform: "capitalize" }}>{monthLabel}</div> : null}
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  justifyItems: isMobile ? "stretch" : "end",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr 1fr" : "auto auto",
                    gap: 10,
                    alignItems: "end",
                  }}
                >
                  {/* Mes compacto */}
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ color: "#6b7280", fontWeight: 1100, fontSize: 12 }}>Mes</div>
                    <select
                      value={month || ""}
                      onChange={(e) => changeMonth(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "9px 10px",
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        fontWeight: 1100,
                        background: "#fff",
                        textTransform: "capitalize",
                        height: 42,
                      }}
                      disabled={months.length === 0}
                      title={monthLabel}
                    >
                      {months.length === 0 ? <option value="">{month || "—"}</option> : null}
                      {months.map((m) => (
                        <option key={m} value={m}>
                          {formatMonthLabel(m)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button onClick={refreshAll} style={btnPrimary}>
                    Actualizar
                  </button>
                </div>

                {/* Logout pequeño y limpio */}
                <button onClick={logout} style={btnGhost}>
                  Cerrar sesión
                </button>
              </div>
            </div>

            {/* Row B: Nav pills */}
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
              {pill("/panel", "📊", "Dashboard")}
              {pill("/panel/invoices", "🧾", "Facturas")}
              {canSeeIncidents ? (
                pill("/panel/incidents", "⚠️", "Incidencias")
              ) : (
                <span
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    color: "#9ca3af",
                    fontWeight: 1100,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    whiteSpace: "nowrap",
                    flex: "0 0 auto",
                  }}
                >
                  ⚠️ Incidencias
                </span>
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
