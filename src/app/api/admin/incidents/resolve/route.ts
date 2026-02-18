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

type AdminCheck =
  | { ok: true; uid: string; admin_worker_id: string }
  | { ok: false; status: number; error: string };

async function assertAdmin(db: any, token: string): Promise<AdminCheck> {
  const { data: u, error: eu } = await db.auth.getUser(token);
  if (eu || !u?.user) return { ok: false, status: 401, error: "BAD_TOKEN" };
  const uid = u.user.id;

  const { data: me, error: eme } = await db
    .from("workers")
    .select("id,role,is_active")
    .eq("user_id", uid)
    .maybeSingle();

  if (eme) return { ok: false, status: 500, error: eme.message };
  if (!me) return { ok: false, status: 403, error: "NO_WORKER" };
  if (!me.is_active) return { ok: false, status: 403, error: "INACTIVE" };
  if (me.role !== "admin") return { ok: false, status: 403, error: "NOT_ADMIN" };

  return { ok: true, uid, admin_worker_id: me.id };
}

export async function POST(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const incident_id = body?.incident_id as string | undefined;
    const action = String(body?.action || "").toLowerCase(); // justified | unjustified
    const penalty_eur_raw = body?.penalty_eur;

    if (!incident_id) return NextResponse.json({ ok: false, error: "MISSING_INCIDENT_ID" }, { status: 400 });
    if (action !== "justified" && action !== "unjustified")
      return NextResponse.json({ ok: false, error: "BAD_ACTION" }, { status: 400 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    const a = await assertAdmin(db, token);
    if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });

    const nextStatus = action === "justified" ? "justified" : "unjustified";
    const nextPenalty =
      action === "justified" ? 0 : (Number(penalty_eur_raw || 0) || 0);

    const patch: any = {
      status: nextStatus,
      penalty_eur: nextPenalty,
    };

    // si existen en tu tabla, las rellenamos (si no existen, no pasa nada)
    patch.resolved_at = new Date().toISOString();
    patch.resolved_by = a.admin_worker_id;

    const { data: upd, error: eupd } = await db
      .from("shift_incidents")
      .update(patch)
      .eq("id", incident_id)
      .select("id,status,penalty_eur")
      .maybeSingle();

    if (eupd) return NextResponse.json({ ok: false, error: eupd.message }, { status: 500 });
    if (!upd) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    return NextResponse.json({ ok: true, incident: upd });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
