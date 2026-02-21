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

    // worker + role
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const role = normRole((me as any).role);
    if (role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    // ✅ lista pendientes (tabla shift_incidents)
    // Nota: tu UI espera worker_name, así que hacemos join a workers
    const { data: rows, error } = await db
      .from("shift_incidents")
      .select(
        `
        id,
        incident_date,
        month_date,
        kind,
        incident_type,
        status,
        minutes_late,
        penalty_eur,
        notes,
        worker_id,
        workers:workers ( display_name )
      `
      )
      .eq("status", "pending")
      .order("incident_date", { ascending: false })
      .limit(5000);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const items = (rows || []).map((r: any) => ({
      id: r.id,
      incident_date: r.incident_date ?? null,
      month_date: r.month_date ?? null,
      kind: r.kind ?? null,
      incident_type: r.incident_type ?? null,
      status: r.status ?? null,
      minutes_late: r.minutes_late ?? null,
      penalty_eur: r.penalty_eur ?? null,
      notes: r.notes ?? null,
      worker_id: r.worker_id ?? null,
      worker_name: r.workers?.display_name ?? null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
