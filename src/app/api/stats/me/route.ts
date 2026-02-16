import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    // 1) validar usuario
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    // 2) buscar worker asociado (por user_id)
    const adminDb = createClient(supabaseUrl, serviceKey);

    const { data: w, error: wErr } = await adminDb
      .from("workers")
      .select("id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });
    if (!w) return NextResponse.json({ ok: true, worker: null, stats: null });

    // 3) stats
    const { data: rows, error: rErr } = await adminDb
      .from("attendance_rows")
      .select("minutes,calls,codigo,captado")
      .eq("worker_id", w.id)
      .limit(50000);

    if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 400 });

    const stats = {
      minutes: 0,
      calls: 0,
      captadas: 0,
      free: 0,
      rueda: 0,
      cliente: 0,
      repite: 0,
    };

    for (const r of (rows as any[]) || []) {
      const mins = Number(r.minutes) || 0;
      stats.minutes += mins;
      stats.calls += Number(r.calls) || 0;
      if (r.captado) stats.captadas += 1;

      if (r.codigo === "free") stats.free += mins;
      if (r.codigo === "rueda") stats.rueda += mins;
      if (r.codigo === "cliente") stats.cliente += mins;
      if (r.codigo === "repite") stats.repite += mins;
    }

    return NextResponse.json({ ok: true, worker: w, stats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
