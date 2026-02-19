import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function authOk(req: Request) {
  // Soporta 2 formas:
  // 1) Authorization: Bearer <CRON_SECRET>  (recomendado)
  // 2) ?secret=<CRON_SECRET> (solo si alguna vez lo necesitas manual)
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1] || "";

  if (bearer && bearer === secret) return true;

  const url = new URL(req.url);
  const qs = url.searchParams.get("secret") || "";
  if (qs && qs === secret) return true;

  return false;
}

export async function GET(req: Request) {
  try {
    if (!authOk(req)) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // ✅ llamamos a tu función SQL (ajusta el nombre si el tuyo es distinto)
    // Ejemplo: select rebuild_monthly_rankings(current_date);
    const { error } = await db.rpc("rebuild_monthly_rankings", {});
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
