import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type Body = {
  email: string;
  password: string;
  role: "tarotista" | "central" | "admin";
  display_name: string;
  external_ref?: string | null;
};

export async function OPTIONS() {
  // Por si el navegador hace preflight (no debería en same-origin, pero así no rompe)
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = (await req.json()) as Body;

    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const role = body.role;
    const display_name = (body.display_name || "").trim();
    const external_ref = (body.external_ref || "").trim() || null;

    if (!email || !password || !role || !display_name) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    // 1) Cliente con ANON + token del usuario actual (para comprobar que es admin vía RLS)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: me, error: meErr } = await userClient.auth.getUser();
    if (meErr || !me?.user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });
    }

    const { data: adminRow, error: aErr } = await userClient
      .from("app_admins")
      .select("user_id")
      .eq("user_id", me.user.id)
      .maybeSingle();

    if (aErr) return NextResponse.json({ ok: false, error: aErr.message }, { status: 400 });
    if (!adminRow) return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    // 2) Cliente SERVICE ROLE (solo servidor) para crear usuario + insertar en workers
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: created, error: cErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (cErr || !created?.user) {
      return NextResponse.json({ ok: false, error: cErr?.message || "CREATE_USER_FAILED" }, { status: 400 });
    }

    const newUserId = created.user.id;

    const { error: wErr } = await adminClient.from("workers").insert({
      user_id: newUserId,
      role,
      display_name,
      email,
      external_ref,
      is_active: true,
    });

    if (wErr) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, user_id: newUserId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
