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

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // validar user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    // comprobar admin
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id,role,is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!me.is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });
    if (me.role !== "admin") return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    // listar pendientes
    const { data, error } = await db
      .from("shift_incidents")
      .select("id,worker_id,incident_date,month_date,kind,minutes_late,status,penalty_eur,notes,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // añadir nombre/rol del worker
    const workerIds = Array.from(new Set((data || []).map((x: any) => x.worker_id)));
    let workersById = new Map<string, any>();
    if (workerIds.length) {
      const { data: ws } = await db
        .from("workers")
        .select("id,display_name,role")
        .in("id", workerIds);
      for (const w of ws || []) workersById.set(w.id, w);
    }

    const rows = (data || []).map((x: any) => {
      const w = workersById.get(x.worker_id) || null;
      return {
        ...x,
        worker_name: w?.display_name || null,
        worker_role: w?.role || null,
      };
    });

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
