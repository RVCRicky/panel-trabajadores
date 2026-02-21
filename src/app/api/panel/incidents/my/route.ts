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

    // worker
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const myWorkerId = String((me as any).id || "");
    const myRole = normRole((me as any).role);

    // mes opcional
    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");
    const month_date = monthParam || null;

    let q = db
      .from("shift_incidents")
      .select("id, incident_date, month_date, kind, incident_type, status, minutes_late, penalty_eur, notes")
      .eq("worker_id", myWorkerId)
      .order("incident_date", { ascending: false })
      .limit(2000);

    if (month_date) q = q.eq("month_date", month_date);

    const { data: rows, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      worker: { id: myWorkerId, role: myRole, display_name: (me as any).display_name || "" },
      items: rows || [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
