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

    // 1) token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });
    const callerAuthId = u.user.id;

    // 2) buscar worker por user_id
    const { data: meW, error: wErr } = await supabaseAdmin
      .from("workers")
      .select("id,is_active")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });
    if (!meW || !meW.is_active) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    // 3) facturas del worker (orden desc)
    const { data: invoices, error: iErr } = await supabaseAdmin
      .from("worker_invoices")
      .select("id,worker_id,month_date,status,total_eur,worker_note,admin_note,locked_at")
      .eq("worker_id", meW.id)
      .order("month_date", { ascending: false });

    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, invoices: invoices || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
