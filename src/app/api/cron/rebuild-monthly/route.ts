// src/app/api/cron/rebuild-monthly/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function ymFirstDay(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function subMonthsIso(iso: string, months: number) {
  // iso = "YYYY-MM-01"
  const [y, m] = iso.split("-").map((x) => Number(x));
  if (!y || !m) return iso;
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() - months);
  return ymFirstDay(dt);
}

export async function GET(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const secret = urlObj.searchParams.get("secret") || "";
    const expected = getEnv("CRON_SECRET");

    if (!secret || secret !== expected) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // último mes disponible en attendance_rows
    const { data: last, error: elast } = await db
      .from("attendance_rows")
      .select("month_date")
      .not("month_date", "is", null)
      .order("month_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (elast) return NextResponse.json({ ok: false, error: elast.message }, { status: 500 });

    const month_date: string | null = (last as any)?.month_date || null;

    if (!month_date) {
      return NextResponse.json({ ok: true, rebuilt: [], note: "NO_MONTH_DATE_DATA", at: new Date().toISOString() });
    }

    const monthPrev = subMonthsIso(month_date, 1);

    // rebuild mes actual
    const r1 = await db.rpc("rebuild_monthly_rankings", { p_month: month_date });
    if (r1.error) {
      return NextResponse.json(
        { ok: false, error: r1.error.message, step: "rebuild_current", month_date },
        { status: 500 }
      );
    }

    // rebuild mes anterior
    const r2 = await db.rpc("rebuild_monthly_rankings", { p_month: monthPrev });
    if (r2.error) {
      return NextResponse.json(
        { ok: false, error: r2.error.message, step: "rebuild_prev", month_date: monthPrev },
        { status: 500 }
      );
    }

    // conteos (opcional)
    const { count: cNow, error: eNow } = await db
      .from("monthly_rankings")
      .select("*", { count: "exact", head: true })
      .eq("month_date", month_date);

    if (eNow) return NextResponse.json({ ok: false, error: eNow.message }, { status: 500 });

    const { count: cPrev, error: ePrev } = await db
      .from("monthly_rankings")
      .select("*", { count: "exact", head: true })
      .eq("month_date", monthPrev);

    if (ePrev) return NextResponse.json({ ok: false, error: ePrev.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      rebuilt: [
        { month_date, workers: cNow ?? null },
        { month_date: monthPrev, workers: cPrev ?? null },
      ],
      at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
