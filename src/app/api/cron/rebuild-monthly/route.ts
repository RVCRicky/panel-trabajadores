import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function authOk(req: Request) {
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

function firstDayOfMonth(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function GET(req: Request) {
  try {
    if (!authOk(req)) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // Mes objetivo: por defecto mes actual (UTC) o ?month=YYYY-MM-01
    const u = new URL(req.url);
    const month = u.searchParams.get("month") || firstDayOfMonth(new Date());

    // 1) Rankings
    const r1 = await db.rpc("rebuild_monthly_rankings", { p_month: month });
    if (r1.error) {
      return NextResponse.json({ ok: false, where: "rankings", error: r1.error.message }, { status: 500 });
    }

    // 2) Facturas (penalizaciones)
    const r2 = await db.rpc("rebuild_monthly_invoices", { p_month: month });
    if (r2.error) {
      return NextResponse.json({ ok: false, where: "invoices", error: r2.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, month });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
