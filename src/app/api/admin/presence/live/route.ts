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

export async function GET(req: Request) {
  try {
    const { uid, error } = await getUidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error }, { status: 401 });

    const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
    const serviceKey = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
    const db = createClient(supabaseUrl, serviceKey);

    // admin check
    const { data: isAdmin } = await db.from("app_admins").select("user_id").eq("user_id", uid).maybeSingle();
    if (!isAdmin) return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    // ✅ Leer estado persistente
    const { data: cur, error: cErr } = await db
      .from("presence_current")
      .select("worker_id, state, last_change_at, active_session_id");
    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });

    const workerIds = (cur || []).map((r) => r.worker_id);

    const { data: workers, error: wErr } = await db
      .from("workers")
      .select("id, display_name, role, is_active")
      .in("id", workerIds.length ? workerIds : ["00000000-0000-0000-0000-000000000000"])
      .order("role", { ascending: true })
      .order("display_name", { ascending: true });

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });

    const wMap = new Map<string, any>();
    (workers || []).forEach((w) => wMap.set(w.id, w));

    const out = (cur || [])
      .map((r: any) => {
        const w = wMap.get(r.worker_id);
        return {
          worker_id: r.worker_id,
          name: w?.display_name || "—",
          role: w?.role || "—",
          is_active: w?.is_active ?? true,
          state: (r.state || "offline") as "offline" | "online" | "pause" | "bathroom",
          last_change_at: r.last_change_at,
          active_session_id: r.active_session_id,
        };
      })
      // opcional: no mostrar desactivados
      .filter((x) => x.is_active);

    return NextResponse.json({ ok: true, rows: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
