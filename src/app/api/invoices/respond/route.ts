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

    // 1) token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });
    const callerAuthId = u.user.id;

    // 2) body
    const body = (await req.json()) as Body;
    const invoiceId = String(body.invoiceId || "").trim();
    const nextStatus = body.status;
    const workerNote = body.workerNote != null ? String(body.workerNote).trim() : null;

    if (!invoiceId) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });
    if (!["accepted", "rejected", "review"].includes(nextStatus))
      return NextResponse.json({ ok: false, error: "BAD_STATUS" }, { status: 400 });

    // 3) worker del caller
    const { data: meW, error: wErr } = await supabaseAdmin
      .from("workers")
      .select("id,is_active")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });
    if (!meW || !meW.is_active) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    // 4) factura debe ser suya
    const { data: inv, error: invErr } = await supabaseAdmin
      .from("worker_invoices")
      .select("id,worker_id,locked_at")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 400 });
    if (!inv) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (inv.worker_id !== meW.id) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    // ✅ si quieres obligar a que solo se responda cuando está cerrada, descomenta esto:
    // if (!inv.locked_at) {
    //   return NextResponse.json({ ok: false, error: "INVOICE_NOT_CLOSED" }, { status: 400 });
    // }

    const { error: upErr } = await supabaseAdmin
      .from("worker_invoices")
      .update({
        status: nextStatus,
        worker_note: workerNote,
      })
      .eq("id", invoiceId);

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
