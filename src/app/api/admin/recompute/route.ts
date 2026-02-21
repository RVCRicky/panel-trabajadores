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
    const { month } = await req.json();

    if (!month) {
      return NextResponse.json({ ok: false, error: "NO_MONTH" }, { status: 400 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const db = createClient(url, service, { auth: { persistSession: false } });

    const r1 = await db.rpc("recompute_monthly_earnings", { p_month: month });
    if (r1.error) {
      return NextResponse.json({ ok: false, error: r1.error.message }, { status: 500 });
    }

    const r2 = await db.rpc("generate_monthly_bonus", { p_month: month });
    if (r2.error) {
      return NextResponse.json({ ok: false, error: r2.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
