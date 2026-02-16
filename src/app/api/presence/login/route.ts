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

    // 1) worker por user_id
    const { data: w, error: wErr } = await db
      .from("workers")
      .select("id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });
    if (!w) return NextResponse.json({ ok: false, error: "NO_WORKER_PROFILE" }, { status: 400 });

    // 2) ¿ya hay sesión activa?
    const { data: cur } = await db
      .from("presence_current")
      .select("state, active_session_id")
      .eq("worker_id", w.id)
      .maybeSingle();

    if (cur?.active_session_id && cur?.state && cur.state !== "offline") {
      // ya estaba logueado
      return NextResponse.json({
        ok: true,
        alreadyOnline: true,
        worker_id: w.id,
        session_id: cur.active_session_id,
        state: cur.state,
      });
    }

    // 3) crear sesión
    const { data: s, error: sErr } = await db
      .from("presence_sessions")
      .insert({ worker_id: w.id })
      .select("id, started_at")
      .single();

    if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 });

    // 4) evento online
    const { error: eErr } = await db.from("presence_events").insert({
      session_id: s.id,
      worker_id: w.id,
      state: "online",
      meta: { by: "self" },
    });
    if (eErr) return NextResponse.json({ ok: false, error: eErr.message }, { status: 500 });

    // 5) upsert estado actual
    const { error: cErr } = await db.from("presence_current").upsert(
      {
        worker_id: w.id,
        state: "online",
        last_change_at: new Date().toISOString(),
        active_session_id: s.id,
      },
      { onConflict: "worker_id" }
    );
    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      worker_id: w.id,
      session_id: s.id,
      state: "online",
      started_at: s.started_at,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
