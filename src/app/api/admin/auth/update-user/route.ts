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

function normRole(r: any) {
  return String(r || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // 1) validar quién llama (debe ser admin)
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const callerUid = u.user.id;

    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", callerUid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    if (normRole((me as any).role) !== "admin") {
      return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });
    }

    // 2) payload
    const body = await req.json().catch(() => null);
    const uid = String(body?.uid || "").trim();
    const email = String(body?.email || "").trim();
    const password = String(body?.password || "").trim();

    if (!uid) return NextResponse.json({ ok: false, error: "MISSING_UID" }, { status: 400 });
    if (!email && !password) return NextResponse.json({ ok: false, error: "NOTHING_TO_UPDATE" }, { status: 400 });

    // 3) update Auth user (ADMIN)
    const patch: any = {};
    if (email) patch.email = email;
    if (password) patch.password = password;

    const { data: updated, error: eup } = await db.auth.admin.updateUserById(uid, patch);
    if (eup) return NextResponse.json({ ok: false, error: eup.message }, { status: 400 });

    return NextResponse.json({
      ok: true,
      user: { id: updated.user?.id, email: updated.user?.email },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
