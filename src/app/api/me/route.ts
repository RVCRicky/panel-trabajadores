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
    const supabaseAnon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

    // Leemos el JWT del usuario desde la cookie (Authorization header no lo usamos aquí)
    // En este MVP simple vamos a pedirlo por header: Authorization: Bearer <access_token>
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });
    }

    const userId = userRes.user.id;

    const { data: worker, error: wErr } = await supabase
      .from("workers")
      .select("id, role, display_name, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (wErr) {
      return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });
    }

    if (!worker) {
      return NextResponse.json({ ok: true, userId, worker: null });
    }

    return NextResponse.json({ ok: true, userId, worker });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
