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
  if (!token) return { uid: null as string | null, error: "NO_TOKEN" as const };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  const uid = data?.user?.id || null;
  if (!uid) return { uid: null, error: "NOT_AUTH" as const };
  return { uid, error: null as any };
}

export async function POST(req: Request) {
  try {
    const { uid, error } = await getUidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error }, { status: 401 });

    const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
    const serviceKey = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
    const db = createClient(supabaseUrl, serviceKey);

    // 1) worker de este user
    const { data: worker, error: wErr } = await db
      .from("workers")
      .select("id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });
    if (!worker) return NextResponse.json({ ok: false, error: "NO_WORKER_PROFILE" }, { status: 404 });
    if (!worker.is_active) return NextResponse.json({ ok: false, error: "USER_DISABLED" }, { status: 403 });

    // 2) si ya hay sesión activa, la reutilizamos
    const { data: active, error: aErr } = await db
      .from("presence_sessions")
      .select("id, started_at")
      .eq("worker_id", worker.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (aErr) return NextResponse.json({ ok: false, error: aErr.message }, { status: 500 });

    let sessionId = (active?.id as string | null) || null;
    let startedAt = (active?.started_at as string | null) || null;

    if (!sessionId) {
      const { data: created, error: cErr } = await db
        .from("presence_sessions")
        .insert({ worker_id: worker.id })
        .select("id, started_at")
        .single();

      if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
      sessionId = created.id;
      startedAt = created.started_at;
    }

    // 3) evento: online
    const nowIso = new Date().toISOString();

    const { error: eErr } = await db.from("presence_events").insert({
      session_id: sessionId,
      worker_id: worker.id,
      state: "online",
      at: nowIso,
    });

    if (eErr) return NextResponse.json({ ok: false, error: eErr.message }, { status: 500 });

    // ✅ 4) FORZAR presence_current (persistente)
    const { error: pcErr } = await db.from("presence_current").upsert(
      {
        worker_id: worker.id,
        state: "online",
        last_change_at: nowIso,
        active_session_id: sessionId,
      },
      { onConflict: "worker_id" }
    );

    if (pcErr) return NextResponse.json({ ok: false, error: pcErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      started_at: startedAt,
      worker: {
        id: worker.id,
        role: worker.role,
        display_name: worker.display_name,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
