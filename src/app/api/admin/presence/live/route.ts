// src/app/api/admin/presence/live/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

type PresenceState = "offline" | "online" | "pause" | "bathroom";

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    // ✅ Service client (auth + leer todo)
    const db = createClient(url, service, { auth: { persistSession: false } });

    // ✅ 1) Validar usuario con token
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    const uid = u.user.id;

    // ✅ 2) Confirmar admin
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id,role,is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!me.is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });
    if (me.role !== "admin") return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    // ✅ 3) workers activos (centrales + tarotistas)
    const { data: ws, error: ews } = await db
      .from("workers")
      .select("id,display_name,role,is_active")
      .eq("is_active", true);

    if (ews) return NextResponse.json({ ok: false, error: ews.message }, { status: 500 });

    const workers = (ws || []).filter((w: any) => w.role === "central" || w.role === "tarotista");

    const workerById = new Map<string, any>();
    for (const w of workers) workerById.set(w.id, w);

    // ✅ 4) presencia_current
    const { data: cur, error: ecur } = await db
      .from("presence_current")
      .select("worker_id,state,active_session_id,last_change_at");

    if (ecur) return NextResponse.json({ ok: false, error: ecur.message }, { status: 500 });

    const byWorker = new Map<string, any>();
    for (const c of cur || []) byWorker.set(c.worker_id, c);

    const rowsAll = workers.map((w: any) => {
      const c = byWorker.get(w.id) || null;
      const state: PresenceState = (c?.state as PresenceState) || "offline";
      return {
        worker_id: w.id,
        name: w.display_name,
        role: w.role,
        state,
        last_change_at: c?.last_change_at || new Date(0).toISOString(),
        active_session_id: c?.active_session_id || null,
      };
    });

    // ✅ 4b) filtro: por defecto SOLO no-offline
    const { searchParams } = new URL(req.url);
    const show = (searchParams.get("show") || "").toLowerCase(); // "all" muestra también offline
    const rows = show === "all" ? rowsAll : rowsAll.filter((r) => r.state !== "offline");

    // orden: online, pause, bathroom + nombre
    const orderKey = (st: PresenceState) => (st === "online" ? 0 : st === "pause" ? 1 : st === "bathroom" ? 2 : 9);
    rows.sort((a, b) => {
      const d = orderKey(a.state) - orderKey(b.state);
      if (d !== 0) return d;
      return String(a.name).localeCompare(String(b.name));
    });

    // ✅ 5) QUIÉN DEBERÍA ESTAR Y NO ESTÁ (vista shift_missing_now)
    // Enriquecemos con nombre/rol si la vista solo trae worker_id
    let missing: any[] = [];
    const missRes = await db.from("shift_missing_now").select("*");
    if (!missRes.error) {
      const raw = missRes.data || [];
      missing = raw.map((x: any) => {
        const w = workerById.get(x.worker_id) || null;
        return {
          ...x,
          name: x.name || x.display_name || w?.display_name || null,
          role: x.role || w?.role || null,
        };
      });
    }

    // ✅ 6) (opcional) expected_now para depurar si lo necesitas en UI
    let expected: any[] = [];
    const expRes = await db.from("shift_expected_now").select("*");
    if (!expRes.error) expected = expRes.data || [];

    return NextResponse.json({
      ok: true,
      rows,
      rowsCount: rows.length,
      missingCount: missing.length,
      missing,
      expectedCount: expected.length,
      expected,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
