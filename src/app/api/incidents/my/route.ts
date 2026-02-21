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

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");

    // meses disponibles SOLO del worker
    const { data: monthRows, error: emonths } = await db
      .from("shift_incidents")
      .select("month_date")
      .eq("worker_id", (me as any).id)
      .order("month_date", { ascending: false })
      .limit(48);

    if (emonths) return NextResponse.json({ ok: false, error: emonths.message }, { status: 500 });

    const months = Array.from(
      new Set((monthRows || []).map((r: any) => r.month_date).filter(Boolean))
    ) as string[];

    let month_date = monthParam || months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        me: { id: (me as any).id, display_name: (me as any).display_name || "" },
        items: [],
        summary: { total: 0, pending: 0, justified: 0, unjustified: 0, penalty_eur: 0 },
      });
    }

    const { data: items, error: ei } = await db
      .from("shift_incidents")
      .select("id, month_date, incident_date, kind, incident_type, status, minutes_late, penalty_eur, notes, created_at")
      .eq("worker_id", (me as any).id)
      .eq("month_date", month_date)
      .order("incident_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20000);

    if (ei) return NextResponse.json({ ok: false, error: ei.message }, { status: 500 });

    const summary = {
      total: (items || []).length,
      pending: (items || []).filter((x: any) => x.status === "pending").length,
      justified: (items || []).filter((x: any) => x.status === "justified").length,
      unjustified: (items || []).filter((x: any) => x.status === "unjustified").length,
      penalty_eur: (items || []).reduce((acc: number, r: any) => acc + (Number(r?.penalty_eur) || 0), 0),
    };

    return NextResponse.json({
      ok: true,
      month_date,
      months,
      me: { id: (me as any).id, display_name: (me as any).display_name || "" },
      items: items || [],
      summary,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
