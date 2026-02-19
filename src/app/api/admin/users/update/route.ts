import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export async function POST(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const user_id = String(body?.user_id || "");
    const new_email = String(body?.new_email || "");
    const new_password = String(body?.new_password || "");

    if (!user_id || !new_email) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const db = createClient(url, service, { auth: { persistSession: false } });

    // 1) validar que quien llama es admin (por token)
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const callerId = u.user.id;

    const { data: caller, error: eCaller } = await db
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", callerId)
      .maybeSingle();

    if (eCaller) return NextResponse.json({ ok: false, error: eCaller.message }, { status: 500 });
    if (!caller || !caller.is_active) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    if (caller.role !== "admin") return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    // 2) actualizar Auth (email + opcional password)
    const payload: any = { email: new_email };
    if (new_password) payload.password = new_password;

    const { error: eUpd } = await db.auth.admin.updateUserById(user_id, payload);
    if (eUpd) return NextResponse.json({ ok: false, error: eUpd.message }, { status: 500 });

    // 3) mantener coherencia en public.workers
    const { error: eW } = await db
      .from("workers")
      .update({ email: new_email, updated_at: new Date().toISOString() })
      .eq("user_id", user_id);

    if (eW) return NextResponse.json({ ok: false, error: eW.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
