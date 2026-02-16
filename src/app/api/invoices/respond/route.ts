import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
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

    const body = await req.json().catch(() => null);
    const invoice_id = body?.invoice_id?.toString?.() || "";
    const action = body?.action?.toString?.() || ""; // accepted | rejected
    const note = (body?.note?.toString?.() || "").slice(0, 500);

    if (!invoice_id || (action !== "accepted" && action !== "rejected")) {
      return NextResponse.json({ ok: false, error: "BAD_INPUT" }, { status: 400 });
    }

    const db = createClient(supabaseUrl, serviceKey);

    // worker del usuario
    const { data: meWorker, error: wErr } = await db
      .from("workers")
      .select("id")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });
    if (!meWorker?.id) return NextResponse.json({ ok: false, error: "NO_WORKER_PROFILE" }, { status: 400 });

    // comprobar que la factura es suya
    const { data: inv, error: invErr } = await db
      .from("invoices")
      .select("id, worker_id, status")
      .eq("id", invoice_id)
      .maybeSingle();

    if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });
    if (!inv?.id) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (inv.worker_id !== meWorker.id) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    // actualizar
    const { error: upErr } = await db
      .from("invoices")
      .update({
        status: action,
        response_note: note || null,
        responded_at: new Date().toISOString(),
      })
      .eq("id", invoice_id);

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
