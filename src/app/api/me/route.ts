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

function isMissingColumnErr(err: any, col: string) {
  const msg = String(err?.message || "");
  return msg.toLowerCase().includes(`column workers.${col}`.toLowerCase()) && msg.toLowerCase().includes("does not exist");
}

export async function GET(req: Request) {
  try {
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

    // Intento A: esquema con worker_id
    let worker: any = null;

    const selWithWorkerId = "id, worker_id, user_id, display_name, role, is_active, created_at, updated_at";
    const selNoWorkerId = "id, user_id, display_name, role, is_active, created_at, updated_at";

    const a = await supa
      .from("workers")
      .select(selWithWorkerId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (a.error) {
      // Si falla porque NO existe workers.worker_id, reintentamos sin esa columna
      if (isMissingColumnErr(a.error, "worker_id")) {
        const b = await supa
          .from("workers")
          .select(selNoWorkerId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (b.error) throw b.error;
        worker = b.data || null;
      } else {
        throw a.error;
      }
    } else {
      worker = a.data || null;
    }

    const role = String(worker?.role || "").toLowerCase();
    const isAdmin = role === "admin";

    // ✅ worker_uuid = id unificado para el resto del sistema
    // Si existe worker_id, usamos ese. Si no, usamos id.
    const worker_uuid = (worker?.worker_id ?? worker?.id) || null;

    return NextResponse.json({
      ok: true,
      isAdmin,
      worker_uuid,
      // mantenemos worker tal cual (con o sin worker_id)
      worker: worker || null,
      user: {
        id: user.id,
        email: user.email || null,
        isAdmin,
        worker: worker || null,
        worker_uuid,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
