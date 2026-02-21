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

function monthDateFromISO(d: string) {
  // d = YYYY-MM-DD
  const [y, m] = String(d || "").split("-");
  const yy = Number(y);
  const mm = Number(m);
  if (!yy || !mm) return null;
  const dt = new Date(Date.UTC(yy, mm - 1, 1));
  return dt.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // auth
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    const uid = u.user.id;

    // admin check
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me || !(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });
    if (normRole((me as any).role) !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const body = await req.json().catch(() => null);
    const worker_id = String(body?.worker_id || "");
    const incident_date = String(body?.incident_date || "");
    const incident_type = String(body?.incident_type || "leve").toLowerCase();
    const notes = String(body?.notes || "").trim();

    if (!worker_id) return NextResponse.json({ ok: false, error: "MISSING_WORKER" }, { status: 400 });
    if (!incident_date) return NextResponse.json({ ok: false, error: "MISSING_DATE" }, { status: 400 });

    const month_date = monthDateFromISO(incident_date);
    if (!month_date) return NextResponse.json({ ok: false, error: "BAD_DATE" }, { status: 400 });

    // opcional: validar que worker existe y es tarotista
    const { data: w, error: ew } = await db
      .from("workers")
      .select("id, role, is_active")
      .eq("id", worker_id)
      .maybeSingle();

    if (ew) return NextResponse.json({ ok: false, error: ew.message }, { status: 500 });
    if (!w) return NextResponse.json({ ok: false, error: "WORKER_NOT_FOUND" }, { status: 400 });
    if (!(w as any).is_active) return NextResponse.json({ ok: false, error: "WORKER_INACTIVE" }, { status: 400 });

    // Insert incidencia manual
    const { data: ins, error: ei } = await db
      .from("shift_incidents")
      .insert({
        worker_id,
        incident_date,
        month_date,
        kind: "manual",
        incident_type,        // 'leve' | 'moderada' | 'grave' (o lo que uses)
        status: "pending",
        minutes_late: null,
        penalty_eur: 0,
        notes: notes || null,
      })
      .select("id")
      .maybeSingle();

    if (ei) return NextResponse.json({ ok: false, error: ei.message }, { status: 500 });

    return NextResponse.json({ ok: true, id: ins?.id || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
