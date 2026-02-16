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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await userClient.auth.getUser();
    const uid = u?.user?.id || null;
    if (!uid) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const db = createClient(supabaseUrl, serviceKey);

    // buscar su worker
    const { data: meWorker, error: wErr } = await db
      .from("workers")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });

    if (!meWorker?.id) {
      return NextResponse.json({ ok: true, invoices: [] });
    }

    const { data: invoices, error: invErr } = await db
      .from("invoices")
      .select("id, worker_id, month_date, file_path, status, response_note, responded_at, created_at")
      .eq("worker_id", meWorker.id)
      .order("month_date", { ascending: false })
      .limit(100);

    if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });

    // generar signed urls (10 minutos)
    const signed: any[] = [];
    for (const inv of invoices || []) {
      const { data: s, error: sErr } = await db.storage
        .from("invoices")
        .createSignedUrl(inv.file_path, 60 * 10);
      if (sErr) continue;
      signed.push({ ...inv, signed_url: s?.signedUrl || null });
    }

    return NextResponse.json({ ok: true, invoices: signed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
