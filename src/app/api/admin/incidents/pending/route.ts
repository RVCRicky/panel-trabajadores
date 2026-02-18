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

async function assertAdmin(db: any, token: string) {
  const { data: u, error: eu } = await db.auth.getUser(token);
  if (eu || !u?.user) return { ok: false, status: 401, error: "BAD_TOKEN" as const };
  const uid = u.user.id;

  const { data: me, error: eme } = await db
    .from("workers")
    .select("id,role,is_active")
    .eq("user_id", uid)
    .maybeSingle();

  if (eme) return { ok: false, status: 500, error: eme.message as const };
  if (!me) return { ok: false, status: 403, error: "NO_WORKER" as const };
  if (!me.is_active) return { ok: false, status: 403, error: "INACTIVE" as const };
  if (me.role !== "admin") return { ok: false, status: 403, error: "NOT_ADMIN" as const };

  return { ok: true, uid };
}

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    const a = await assertAdmin(db, token);
    if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });

    // pendientes de hoy primero, luego el resto
    const { data, error } = await db
      .from("shift_incidents")
      .select("id,worker_id,incident_date,month_date,kind,incident_type,minutes_late,status,penalty_eur,notes,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // Traer nombres
    const workerIds = Array.from(new Set((data || []).map((x: any) => x.worker_id))).filter(Boolean);
    let namesById = new Map<string, any>();
    if (workerIds.length) {
      const { data: ws } = await db
        .from("workers")
        .select("id,display_name,role")
        .in("id", workerIds);
      for (const w of ws || []) namesById.set(w.id, w);
    }

    const out = (data || []).map((i: any) => ({
      ...i,
      worker: namesById.get(i.worker_id) || null,
    }));

    return NextResponse.json({ ok: true, incidents: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
