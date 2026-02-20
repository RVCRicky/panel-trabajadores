import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type Body = {
  invoiceId: string;
  status: "accepted" | "rejected" | "review";
  workerNote?: string | null;
};

export async function POST(req: Request) {
  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const ANON_KEY = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    // user
    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const callerAuthId = u.user.id;

    // caller worker
    const { data: caller, error: cErr } = await supabaseAdmin
      .from("workers")
      .select("id,user_id,is_active")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 400 });
    if (!caller) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!caller.is_active) return NextResponse.json({ ok: false, error: "DISABLED" }, { status: 403 });

    const body = (await req.json()) as Body;
    const invoiceId = String(body.invoiceId || "").trim();
    if (!invoiceId) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    // invoice belongs to worker
    const { data: inv, error: iErr } = await supabaseAdmin
      .from("worker_invoices")
      .select("id,worker_id,locked_at,status")
      .eq("id", invoiceId)
      .maybeSingle();

    if (iErr) return NextResponse.json({ ok: false, error: iErr.message }, { status: 400 });
    if (!inv) return NextResponse.json({ ok: false, error: "INVOICE_NOT_FOUND" }, { status: 404 });
    if (inv.worker_id !== caller.id) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    if (inv.locked_at) return NextResponse.json({ ok: false, error: "LOCKED" }, { status: 400 });

    // update status + note
    const { error: upErr } = await supabaseAdmin
      .from("worker_invoices")
      .update({
        status: body.status,
        worker_note: body.workerNote ?? null,
      })
      .eq("id", invoiceId);

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
