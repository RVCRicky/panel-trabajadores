import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

type Body = {
  workerId: string;
  email?: string | null;
  password?: string | null;
};

export async function POST(req: Request) {
  try {
    // ✅ leer env vars dentro del handler (evita crash en build)
    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const ANON_KEY = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
    });

    // 1) token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 });
    }

    const callerId = u.user.id;

    // 2) check admin
    const { data: caller, error: cErr } = await supabaseAdmin
      .from("worker_profiles")
      .select("role,is_active")
      .eq("id", callerId)
      .maybeSingle();

    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 400 });
    if (!caller) return NextResponse.json({ ok: false, error: "No worker profile" }, { status: 403 });
    if (!caller.is_active) return NextResponse.json({ ok: false, error: "User disabled" }, { status: 403 });
    if (caller.role !== "admin") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // 3) body
    const body = (await req.json()) as Body;
    const workerId = String(body.workerId || "").trim();
    const email = body.email ? String(body.email).trim() : null;
    const password = body.password ? String(body.password) : null;

    if (!workerId) {
      return NextResponse.json({ ok: false, error: "Missing workerId" }, { status: 400 });
    }
    if (!email && !password) {
      return NextResponse.json({ ok: false, error: "Provide email and/or password" }, { status: 400 });
    }

    // 4) update auth user
    const patch: any = {};
    if (email) patch.email = email;
    if (password) patch.password = password;

    const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(workerId, patch);
    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });

    // opcional: confirmar email
    if (email) {
      await supabaseAdmin.auth.admin.updateUserById(workerId, { email_confirm: true } as any);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // ✅ si faltan env vars ahora NO rompe build; devuelve error cuando se llama
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
