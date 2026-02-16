import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnvAny(names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
}

async function getUidFromBearer(req: Request) {
  const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
  const anonKey = getEnvAny(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null, error: "NO_TOKEN" };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  const uid = data?.user?.id || null;
  if (!uid) return { uid: null, error: "NOT_AUTH" };
  return { uid, error: null };
}

export async function POST(req: Request) {
  try {
    const { uid, error } = await getUidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error }, { status: 401 });

    const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
    const serviceKey = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
    const db = createClient(supabaseUrl, serviceKey);

    const { data: w, error: wErr } = await db
      .from("workers")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });
    if (!w) return NextResponse.json({ ok: false, error: "NO_WORKER_PROFILE" }, { status: 400 });

    const { data: cur, error: cErr } = await db
      .from("presence_current")
      .select("active_session_id")
      .eq("worker_id", w.id)
      .maybeSingle();

    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

    const sid = cur?.active_session_id || null;

    // evento offline si había sesión
    if (sid) {
      await db.from("presence_events").insert({
        session_id: sid,
        worker_id: w.id,
        state: "offline",
        meta: { by: "self" },
      });

      // cerrar sesión
      await db
        .from("presence_sessions")
        .update({ ended_at: new Date().toISOString(), ended_reason: "logout" })
        .eq("id", sid)
        .is("ended_at", null);
    }

    // estado actual offline
    const { error: uErr } = await db.from("presence_current").upsert(
      {
        worker_id: w.id,
        state: "offline",
        last_change_at: new Date().toISOString(),
        active_session_id: null,
      },
      { onConflict: "worker_id" }
    );
    if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, worker_id: w.id, session_id: sid, state: "offline" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
