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
  const [y, m] = iso.split("-").map((x) => Number(x));
  if (!y || !m) return iso;
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() - months);
  return ymFirstDay(dt);
}

export async function GET(req: Request) {
  const startedAt = new Date();
  let logId: number | null = null;

  const safeJson = (obj: any, status = 200) => NextResponse.json(obj, { status });

  try {
    const urlObj = new URL(req.url);
    const secret = urlObj.searchParams.get("secret") || "";
    const expected = getEnv("CRON_SECRET");

    if (!secret || secret !== expected) {
      return safeJson({ ok: false, error: "UNAUTHORIZED" }, 401);
    }

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // crear log "started"
    {
      const ins = await db
        .from("cron_logs")
        .insert({
          job: "rebuild-monthly",
          ok: false,
          details: { stage: "started" },
          started_at: startedAt.toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (!ins.error && ins.data?.id) logId = ins.data.id as any;
    }

    // último mes con datos
    const { data: last, error: elast } = await db
      .from("attendance_rows")
      .select("month_date")
      .not("month_date", "is", null)
      .order("month_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (elast) throw new Error(elast.message);

    const month_date: string | null = (last as any)?.month_date || null;

    if (!month_date) {
      const finishedAt = new Date();
      const details = { stage: "no_data", note: "NO_MONTH_DATE_DATA" };

      if (logId) {
        await db
          .from("cron_logs")
          .update({ ok: true, details, finished_at: finishedAt.toISOString() })
          .eq("id", logId);
      }

      return safeJson({ ok: true, rebuilt: [], ...details, at: finishedAt.toISOString() });
    }

    const monthPrev = subMonthsIso(month_date, 1);

    // rebuild mes actual
    const r1 = await db.rpc("rebuild_monthly_rankings", { p_month: month_date });
    if (r1.error) throw new Error(`rebuild_current: ${r1.error.message}`);

    // rebuild mes anterior
    const r2 = await db.rpc("rebuild_monthly_rankings", { p_month: monthPrev });
    if (r2.error) throw new Error(`rebuild_prev: ${r2.error.message}`);

    // conteos
    const { count: cNow, error: eNow } = await db
      .from("monthly_rankings")
      .select("*", { count: "exact", head: true })
      .eq("month_date", month_date);
    if (eNow) throw new Error(eNow.message);

    const { count: cPrev, error: ePrev } = await db
      .from("monthly_rankings")
      .select("*", { count: "exact", head: true })
      .eq("month_date", monthPrev);
    if (ePrev) throw new Error(ePrev.message);

    const finishedAt = new Date();
    const details = {
      stage: "ok",
      rebuilt: [
        { month_date, workers: cNow ?? null },
        { month_date: monthPrev, workers: cPrev ?? null },
      ],
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
    };

    if (logId) {
      await db
        .from("cron_logs")
        .update({ ok: true, details, finished_at: finishedAt.toISOString() })
        .eq("id", logId);
    } else {
      await db
        .from("cron_logs")
        .insert({ job: "rebuild-monthly", ok: true, details, started_at: startedAt.toISOString(), finished_at: finishedAt.toISOString() });
    }

    return safeJson({ ok: true, ...details, at: finishedAt.toISOString() });
  } catch (e: any) {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (url && service) {
        const db = createClient(url, service, { auth: { persistSession: false } });
        const finishedAt = new Date();

        const details = {
          stage: "fail",
          error: e?.message || "SERVER_ERROR",
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
        };

        if (logId) {
          await db
            .from("cron_logs")
            .update({ ok: false, details, finished_at: finishedAt.toISOString() })
            .eq("id", logId);
        } else {
          await db
            .from("cron_logs")
            .insert({ job: "rebuild-monthly", ok: false, details, started_at: startedAt.toISOString(), finished_at: finishedAt.toISOString() });
        }
      }
    } catch {
      // si incluso loguear falla, no rompemos respuesta
    }

    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
