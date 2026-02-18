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

    const db = createClient(url, service, { auth: { persistSession: false } });

    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const uid = u.user.id;

    const { data: me, error: eme } = await db
      .from("workers")
      .select("id,role,is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!me.is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    // estado actual
    const { data: cur, error: ecur } = await db
      .from("presence_current")
      .select("state,active_session_id,last_change_at")
      .eq("worker_id", me.id)
      .maybeSingle();

    if (ecur) return NextResponse.json({ ok: false, error: ecur.message }, { status: 500 });

    // sesión abierta (para started_at)
    const { data: ses, error: eses } = await db
      .from("presence_sessions")
      .select("id,started_at,ended_at")
      .eq("worker_id", me.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (eses) return NextResponse.json({ ok: false, error: eses.message }, { status: 500 });

    const state: PresenceState =
      (cur?.state as PresenceState) || (ses?.started_at ? "online" : "offline");

    return NextResponse.json({
      ok: true,
      state,
      session_id: cur?.active_session_id || ses?.id || null,
      started_at: ses?.started_at || null,
      last_change_at: cur?.last_change_at || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
