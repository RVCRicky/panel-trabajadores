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
    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const ANON_KEY = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const callerAuthId = u.user.id;

    const { data: caller, error: cErr } = await supabaseAdmin
      .from("workers")
      .select("id,role,is_active,user_id")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 400 });
    if (!caller) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!caller.is_active) return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });
    if (caller.role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const { data: invoices, error: iErr } = await supabaseAdmin
      .from("worker_invoices")
      .select(
        "id,worker_id,month_date,status,base_salary_eur,bonuses_eur,penalties_eur,total_eur,worker_note,admin_note,locked_at, workers(display_name)"
      )
      .order("month_date", { ascending: false });

    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 400 });

    // normalizar relación
    const out = (invoices || []).map((x: any) => ({
      ...x,
      worker: x.workers ? { display_name: x.workers.display_name } : null,
      workers: undefined,
    }));

    return NextResponse.json({ ok: true, invoices: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
