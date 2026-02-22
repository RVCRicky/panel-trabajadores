// src/app/api/bonus/rules/route.ts
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
  return m ? m[1] : null;
}

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY");

    // Cliente Supabase “como usuario” para validar token
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: u, error: uerr } = await supabase.auth.getUser(token);
    if (uerr || !u?.user?.id) {
      return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    }

    // 👇 AJUSTA ESTE NOMBRE DE TABLA SI EL TUYO ES OTRO
    const { data, error } = await supabase
      .from("bonus_rules")
      .select("ranking_type, position, role, amount_eur, created_at, is_active")
      .order("ranking_type", { ascending: true })
      .order("position", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      bonusRules: (data || []).map((x: any) => ({
        ranking_type: x.ranking_type,
        position: x.position,
        role: x.role,
        amount_eur: x.amount_eur,
        created_at: x.created_at,
        is_active: x.is_active,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error" }, { status: 500 });
  }
}
