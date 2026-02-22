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

// ✅ home según rol (central -> /panel/central, admin -> /panel/admin, tarotista -> /panel)
function homeByRole(r: WorkerRole | null) {
  if (r === "central") return "/panel/central";
  if (r === "admin") return "/panel/admin";
  return "/panel";
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

        // ✅ REDIRECCIÓN AUTOMÁTICA si el rol no corresponde con /panel
        // Evita el “se ve 2 segundos y cambia” y evita quedarse en la página equivocada.
        try {
          const target = homeByRole(r);
          if (pathname === "/panel" && target !== "/panel") {
            const u = new URL(window.location.href);
            const qs = u.searchParams.toString();
            router.replace(qs ? `${target}?${qs}` : target);
            return; // IMPORTANTÍSIMO: paramos aquí
          }
        } catch {}

        const dashRes = await fetch("/api/dashboard/full", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const dashJson = await dashRes.json().catch(() => null);
        if (alive && dashJson?.ok) {
          setMonths(Array.isArray(dashJson.months) ? dashJson.months : []);
          setMonth(dashJson.month_date || null);
        }

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
        setFatal(e?.message || "Error cargando tu sesión.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router, pathname]);

  // Tick timer
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

  const stateTone =
    pState === "online"
      ? "ok"
      : pState === "pause" || pState === "bathroom"
      ? "warn"
      : "neutral";

  const stateText =
    pState === "online"
      ? "ONLINE"
      : pState === "pause"
      ? "PAUSA"
      : pState === "bathroom"
      ? "BAÑO"
      : "OFFLINE";

  const titleRole =
    role === "admin"
      ? "Admin"
      : role === "central"
      ? "Central"
      : "Tarotista";

  const canSeeIncidents =
    role === "tarotista" || role === "central" || role === "admin";

  // ✅ DASHBOARD dinámico según rol
  const dashHref = homeByRole(role);

  function refreshAll() {
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

  const monthLabel = useMemo(
    () => (month ? formatMonthLabel(month) : "—"),
    [month]
  );

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
          gap: 8,
          whiteSpace: "nowrap",
        }}
      >
        <span>{emoji}</span>
        <span>{text}</span>
      </a>
    );
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ fontWeight: 1200 }}>Cargando panel…</div>
      </div>
    );
  }

  if (fatal) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div>{fatal}</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f6f7fb" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 30 }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: 14 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 1400 }}>
                  Tarot Celestial
                </div>
                <div>
                  {titleRole}: <b>{name}</b>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <Badge tone={stateTone as any}>{stateText}</Badge>
                <div>{formatHMS(elapsedSec)}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              {pill(dashHref, "📊", "Dashboard")}
              {pill("/panel/invoices", "🧾", "Facturas")}
              {canSeeIncidents && pill("/panel/incidents", "⚠️", "Incidencias")}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: 16 }}>
        {children}
      </div>
    </div>
  );
}
