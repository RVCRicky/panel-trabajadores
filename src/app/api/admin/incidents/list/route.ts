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

function normRole(r: any) {
  return String(r || "").trim().toLowerCase();
}

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // auth
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    // must be admin
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });
    if (normRole((me as any).role) !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date"); // YYYY-MM-01
    const workerId = urlObj.searchParams.get("worker_id"); // opcional
    const status = urlObj.searchParams.get("status"); // opcional: pending|justified|unjustified
    const kind = urlObj.searchParams.get("kind"); // opcional

    // meses disponibles (de shift_incidents)
    const { data: monthRows, error: emonths } = await db
      .from("shift_incidents")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(48);

    if (emonths) return NextResponse.json({ ok: false, error: emonths.message }, { status: 500 });

    const months = Array.from(
      new Set((monthRows || []).map((r: any) => r.month_date).filter(Boolean))
    ) as string[];

    let month_date = monthParam || months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        workers: [],
        items: [],
      });
    }

    // listado tarotistas para filtro
    const { data: wRows, error: ew } = await db
      .from("workers")
      .select("id, display_name, role, is_active")
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .limit(5000);

    if (ew) return NextResponse.json({ ok: false, error: ew.message }, { status: 500 });

    const tarotistas = (wRows || [])
      .filter((w: any) => normRole(w.role) === "tarotista")
      .map((w: any) => ({ id: w.id, display_name: w.display_name || w.id.slice(0, 8) }));

    // query incidencias del mes
    let q = db
      .from("shift_incidents")
      .select(
        `
        id,
        worker_id,
        month_date,
        incident_date,
        kind,
        incident_type,
        status,
        minutes_late,
        penalty_eur,
        notes,
        created_at,
        updated_at
      `
      )
      .eq("month_date", month_date)
      .order("incident_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20000);

    if (workerId) q = q.eq("worker_id", workerId);
    if (status) q = q.eq("status", status);
    if (kind) q = q.eq("kind", kind);

    const { data: itemsRaw, error: ei } = await q;
    if (ei) return NextResponse.json({ ok: false, error: ei.message }, { status: 500 });

    // map worker_id -> name
    const wMap = new Map<string, string>();
    for (const w of wRows || []) wMap.set(String((w as any).id), String((w as any).display_name || ""));

    const items = (itemsRaw || []).map((it: any) => ({
      ...it,
      worker_name: wMap.get(String(it.worker_id)) || String(it.worker_id).slice(0, 8),
    }));

    return NextResponse.json({
      ok: true,
      month_date,
      months,
      workers: tarotistas,
      items,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
