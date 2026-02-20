// src/app/api/admin/dashboard/overview/route.ts
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
  return m?.[1] || null;
}

function normRole(r: any) {
  return String(r || "").trim().toLowerCase();
}

function toNum(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // validar user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    const uid = u.user.id;

    // worker + role
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    if (normRole((me as any).role) !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");
    let month_date: string | null = monthParam || null;

    // meses disponibles
    const { data: monthsRows, error: emonths } = await db
      .from("monthly_rankings")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    if (emonths) return NextResponse.json({ ok: false, error: emonths.message }, { status: 500 });

    const months = Array.from(new Set((monthsRows || []).map((r: any) => r.month_date).filter(Boolean))) as string[];
    if (!month_date) month_date = months[0] || null;

    // rankings del mes
    const { data: mr, error: emr } = await db
      .from("monthly_rankings")
      .select(
        `
        worker_id,
        minutes_total,
        captadas_total,
        cliente_pct,
        repite_pct,
        workers:workers (
          id,
          display_name,
          role
        )
      `
      )
      .eq("month_date", month_date)
      .limit(10000);

    if (emr) return NextResponse.json({ ok: false, error: emr.message }, { status: 500 });

    const rows = (mr || [])
      .map((x: any) => {
        const w = x.workers || null;
        return {
          worker_id: x.worker_id,
          name: w?.display_name || "—",
          role: w?.role || "",
          minutes: toNum(x.minutes_total),
          captadas: toNum(x.captadas_total),
          cliente_pct: toNum(x.cliente_pct),
          repite_pct: toNum(x.repite_pct),
        };
      })
      .filter((x: any) => x.worker_id);

    const tarotistas = rows.filter((x: any) => normRole(x.role) === "tarotista");

    const totals = {
      minutes: tarotistas.reduce((a: number, b: any) => a + (b.minutes || 0), 0),
      captadas: tarotistas.reduce((a: number, b: any) => a + (b.captadas || 0), 0),
      tarotistas: tarotistas.length,
    };

    const topMinutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes).slice(0, 10);
    const topCaptadas = [...tarotistas].sort((a, b) => b.captadas - a.captadas).slice(0, 10);
    const topCliente = [...tarotistas].sort((a, b) => b.cliente_pct - a.cliente_pct).slice(0, 10);
    const topRepite = [...tarotistas].sort((a, b) => b.repite_pct - a.repite_pct).slice(0, 10);

    // presencia actual
    const { data: pres, error: ep } = await db.from("presence_current").select("state").limit(5000);
    if (ep) return NextResponse.json({ ok: false, error: ep.message }, { status: 500 });

    const presence = { online: 0, pause: 0, bathroom: 0, offline: 0, total: 0 };
    for (const p of pres || []) {
      const st = String((p as any).state || "offline");
      presence.total++;
      if (st === "online") presence.online++;
      else if (st === "pause") presence.pause++;
      else if (st === "bathroom") presence.bathroom++;
      else presence.offline++;
    }

    // incidencias pendientes
    const { count: pendingInc, error: ei } = await db
      .from("shift_incidents")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (ei) return NextResponse.json({ ok: false, error: ei.message }, { status: 500 });

    // serie diaria (minutos por día) para el mes
    const { data: daily, error: ed } = await db
      .from("attendance_rows")
      .select("call_date, minutes")
      .eq("month_date", month_date)
      .limit(100000);
    if (ed) return NextResponse.json({ ok: false, error: ed.message }, { status: 500 });

    const dayMap = new Map<string, number>();
    for (const r of daily || []) {
      const d = (r as any).call_date;
      const m = toNum((r as any).minutes);
      if (!d) continue;
      dayMap.set(d, (dayMap.get(d) || 0) + m);
    }
    const dailySeries = Array.from(dayMap.entries())
      .map(([date, minutes]) => ({ date, minutes }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    // últimos logs del cron
    const { data: logs, error: elogs } = await db
      .from("cron_logs")
      .select("id, job, ok, details, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(20);
    if (elogs) return NextResponse.json({ ok: false, error: elogs.message }, { status: 500 });

    // ✅ FACTURACIÓN REAL (ingresos) del mes: SUM(attendance_rows.importe_eur)
    // Esto viene del Sheets (columna "importe") pero guardado en DB como importe_eur.
    let revenue_eur = 0;
    if (month_date) {
      const { data: revRows, error: revErr } = await db
        .from("attendance_rows")
        .select("importe_eur")
        .eq("month_date", month_date)
        .limit(200000);

      if (revErr) return NextResponse.json({ ok: false, error: revErr.message }, { status: 500 });

      revenue_eur = (revRows || []).reduce((acc: number, r: any) => acc + toNum(r?.importe_eur), 0);
    }

    // ✅ GASTO total (pagos) del mes: SUM(worker_invoices.total_eur)
    let expenses_total_eur = 0;
    if (month_date) {
      const { data: expRows, error: expErr } = await db
        .from("worker_invoices")
        .select("worker_id, total_eur")
        .eq("month_date", month_date)
        .limit(20000);

      if (expErr) return NextResponse.json({ ok: false, error: expErr.message }, { status: 500 });

      expenses_total_eur = (expRows || []).reduce((acc: number, r: any) => acc + toNum((r as any)?.total_eur), 0);
    }

    // ✅ breakdown gastos por rol + top3 gasto tarotistas
    let expenses_tarotistas_eur = 0;
    let expenses_centrales_eur = 0;
    let top3_expense_tarotistas: Array<{ worker_id: string; name: string; role: string; total_eur: number }> = [];

    if (month_date) {
      const { data: expRows2, error: expErr2 } = await db
        .from("worker_invoices")
        .select("worker_id, total_eur")
        .eq("month_date", month_date)
        .limit(20000);

      if (expErr2) return NextResponse.json({ ok: false, error: expErr2.message }, { status: 500 });

      const workerIds = Array.from(new Set((expRows2 || []).map((r: any) => r.worker_id).filter(Boolean)));
      const { data: wRows, error: wErr } = workerIds.length
        ? await db.from("workers").select("id, display_name, role").in("id", workerIds)
        : await db.from("workers").select("id, display_name, role").limit(0);

      if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });

      const wMap = new Map<string, { id: string; display_name: string; role: string }>();
      for (const w of (wRows as any[]) || []) wMap.set(w.id, w);

      const byWorker = new Map<string, number>();
      for (const r of (expRows2 as any[]) || []) {
        const wid = r.worker_id;
        if (!wid) continue;
        const v = toNum(r.total_eur);
        byWorker.set(wid, (byWorker.get(wid) || 0) + v);

        const ww = wMap.get(wid);
        const role = normRole(ww?.role);
        if (role === "tarotista") expenses_tarotistas_eur += v;
        else if (role === "central") expenses_centrales_eur += v;
      }

      const tarotList = Array.from(byWorker.entries())
        .map(([worker_id, total_eur]) => {
          const ww = wMap.get(worker_id);
          return {
            worker_id,
            total_eur,
            name: ww?.display_name || worker_id.slice(0, 8),
            role: ww?.role || "",
          };
        })
        .filter((x) => normRole(x.role) === "tarotista")
        .sort((a, b) => (b.total_eur || 0) - (a.total_eur || 0))
        .slice(0, 3);

      top3_expense_tarotistas = tarotList;
    }

    const margin_eur = revenue_eur - expenses_total_eur;

    return NextResponse.json({
      ok: true,
      month_date,
      months,
      me,
      totals,
      top: {
        minutes: topMinutes,
        captadas: topCaptadas,
        cliente_pct: topCliente,
        repite_pct: topRepite,
      },
      presence,
      incidents: {
        pending: pendingInc ?? 0,
      },
      dailySeries,
      cronLogs: logs || [],
      finance: {
        revenue_eur,
        expenses_total_eur,
        expenses_tarotistas_eur,
        expenses_centrales_eur,
        margin_eur,
        top3_expense_tarotistas,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
