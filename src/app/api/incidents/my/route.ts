// src/app/api/incidents/me/route.ts
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

    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const uid = u.user.id;

    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!me.is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");

    // meses disponibles (desde worker_invoices)
    const { data: invoiceMonths, error: em } = await db
      .from("worker_invoices")
      .select("month_date")
      .eq("worker_id", me.id)
      .order("month_date", { ascending: false })
      .limit(36);

    if (em) return NextResponse.json({ ok: false, error: em.message }, { status: 500 });

    const months = Array.from(new Set((invoiceMonths || []).map((r: any) => r.month_date).filter(Boolean))) as string[];
    const month_date = monthParam || months[0] || null;

    if (!month_date) {
      return NextResponse.json({ ok: true, month_date: null, months: [], items: [], totals: { count: 0, penalty_eur: 0 } });
    }

    const { data: items, error: ei } = await db
      .from("shift_incidents")
      .select("id, incident_date, month_date, kind, incident_type, status, minutes_late, penalty_eur, notes, created_at")
      .eq("worker_id", me.id)
      .eq("month_date", month_date)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (ei) return NextResponse.json({ ok: false, error: ei.message }, { status: 500 });

    const list = (items || []) as any[];
    const penalty = list
      .filter((x) => String(x.status || "").toLowerCase() === "unjustified")
      .reduce((acc, r) => acc + toNum(r.penalty_eur), 0);

    return NextResponse.json({
      ok: true,
      month_date,
      months,
      items: list,
      totals: {
        count: list.length,
        penalty_eur: penalty,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
