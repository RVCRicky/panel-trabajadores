// src/app/api/me/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnvAny(names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
}

function bearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

export async function GET(req: Request) {
  try {
    // ✅ Acepta ambas convenciones (SUPABASE_* y NEXT_PUBLIC_*)
    const SUPABASE_URL = getEnvAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const SUPABASE_ANON_KEY = getEnvAny(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    const SUPABASE_SERVICE_ROLE_KEY = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);

    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });
    }

    // 1) Validar JWT (ANON)
    const supaAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: ures, error: uerr } = await supaAuth.auth.getUser(token);
    if (uerr || !ures?.user) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
    }

    const user = ures.user;

    // 2) Leer worker (SERVICE ROLE)
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: worker, error: werr } = await supa
      .from("workers")
      .select("id, worker_id, user_id, display_name, role, is_active, created_at, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (werr) throw werr;

    const role = String(worker?.role || "").toLowerCase();
    const isAdmin = role === "admin";

    // ✅ Retro-compatible
    return NextResponse.json({
      ok: true,
      isAdmin,
      worker: worker || null,
      user: {
        id: user.id,
        email: user.email || null,
        isAdmin,
        worker: worker || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
