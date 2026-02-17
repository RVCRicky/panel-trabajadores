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

    const body = await req.json().catch(() => null);
    const state = String(body?.state || "").toLowerCase();

    if (!["online", "pause", "bathroom"].includes(state)) {
      return NextResponse.json({ ok: false, error: "BAD_STATE" }, { status: 400 });
    }

    const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
    const serviceKey = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
    const db = createClient(supabaseUrl, serviceKey);

    // worker
    const { data: worker, error: wErr } = await db
      .from("workers")
      .select("id, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });
    if (!worker) return NextResponse.json({ ok: false, error: "NO_WORKER_PROFILE" }, { status: 404 });
    if (!worker.is_active) return NextResponse.json({ ok: false, error: "USER_DISABLED" }, { status: 403 });

    // sesión activa
    const { data: active, error: aErr } = await db
      .from("presence_sessions")
      .select("id")
      .eq("worker_id", worker.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (aErr) return NextResponse.json({ ok: false, error: aErr.message }, { status: 500 });
    if (!active?.id) return NextResponse.json({ ok: false, error: "NO_ACTIVE_SESSION" }, { status: 400 });

    // evento
    const { error: eErr } = await db.from("presence_events").insert({
      session_id: active.id,
      worker_id: worker.id,
      state,
    });

    if (eErr) return NextResponse.json({ ok: false, error: eErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, session_id: active.id, state });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
