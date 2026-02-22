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

    // auth user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    // worker
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const myWorkerId = String((me as any).id);
    const myRole = normRole((me as any).role);

    // month param
    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");

    // meses disponibles para ESTE worker
    const { data: monthRows, error: emonths } = await db
      .from("shift_incidents")
      .select("month_date")
      .eq("worker_id", myWorkerId)
      .order("month_date", { ascending: false })
      .limit(36);

    if (emonths) return NextResponse.json({ ok: false, error: emonths.message }, { status: 500 });

    const months = Array.from(new Set((monthRows || []).map((r: any) => r.month_date).filter(Boolean))) as string[];
    const month_date = monthParam || months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        user: { isAdmin: myRole === "admin", worker: me },
        items: [],
        totals: { penalty_eur: 0 },
      });
    }

    // incidencias del mes (solo del worker logueado)
    const { data: itemsRaw, error: eitems } = await db
      .from("shift_incidents")
      .select("id, incident_date, month_date, kind, incident_type, status, minutes_late, penalty_eur, notes, created_at")
      .eq("worker_id", myWorkerId)
      .eq("month_date", month_date)
      .order("incident_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2000);

    if (eitems) return NextResponse.json({ ok: false, error: eitems.message }, { status: 500 });

    const items = (itemsRaw || []).map((r: any) => ({
      id: r.id,
      incident_date: r.incident_date ?? null,
      month_date: r.month_date ?? null,
      kind: r.kind ?? null,
      incident_type: r.incident_type ?? null,
      status: r.status ?? null,
      minutes_late: r.minutes_late ?? null,
      penalty_eur: r.penalty_eur ?? 0,
      notes: r.notes ?? null,
    }));

    // total penalización del mes (solo NO JUSTIFICADAS)
    const totalPenalty = items.reduce((acc: number, it: any) => {
      const st = String(it.status || "").toLowerCase();
      if (st === "unjustified") return acc + toNum(it.penalty_eur);
      return acc;
    }, 0);

    return NextResponse.json({
      ok: true,
      month_date,
      months,
      user: { isAdmin: myRole === "admin", worker: me },
      items,
      totals: { penalty_eur: totalPenalty },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
