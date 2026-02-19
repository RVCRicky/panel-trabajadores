// src/app/api/dashboard/full/route.ts
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

type RankRowMinutes = {
  worker_id: string;
  name: string;
  minutes: number;
  captadas: number;
  cliente_pct: number;
  repite_pct: number;
};

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

    // 1) validar user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    const uid = u.user.id;

    // 2) worker del usuario
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    // 3) mes seleccionado (opcional) + lista de meses disponibles
    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date"); // "YYYY-MM-01"
    let month_date: string | null = monthParam || null;

    // meses disponibles (para selector en UI)
    const { data: monthsRows, error: emonths } = await db
      .from("monthly_rankings")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    if (emonths) return NextResponse.json({ ok: false, error: emonths.message }, { status: 500 });

    const months = Array.from(
      new Set((monthsRows || []).map((r: any) => r.month_date).filter(Boolean))
    ) as string[];

    // si no pasan month_date, usar el más reciente
    if (!month_date) month_date = months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        user: { isAdmin: normRole((me as any).role) === "admin", worker: me },
        rankings: { minutes: [], repite_pct: [], cliente_pct: [], captadas: [] },
        myEarnings: null,
        winnerTeam: null,
        bonusRules: [],
      });
    }

    // 4) sacar rankings del mes desde monthly_rankings + join a workers
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
      .limit(5000);

    if (emr) return NextResponse.json({ ok: false, error: emr.message }, { status: 500 });

    // 5) normalizar filas
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

    // solo tarotistas para ranking principal
    const tarotistas = rows.filter((x: any) => normRole(x.role) === "tarotista");

    const rankMinutes: RankRowMinutes[] = [...tarotistas].sort((a, b) => b.minutes - a.minutes);

    const rankCaptadas = [...tarotistas]
      .sort((a, b) => b.captadas - a.captadas)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, captadas: x.captadas }));

    const rankCliente = [...tarotistas]
      .sort((a, b) => b.cliente_pct - a.cliente_pct)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, cliente_pct: x.cliente_pct }));

    const rankRepite = [...tarotistas]
      .sort((a, b) => b.repite_pct - a.repite_pct)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, repite_pct: x.repite_pct }));

    return NextResponse.json({
      ok: true,
      month_date,
      months,
      user: { isAdmin: normRole((me as any).role) === "admin", worker: me },
      rankings: {
        minutes: rankMinutes,
        repite_pct: rankRepite,
        cliente_pct: rankCliente,
        captadas: rankCaptadas,
      },
      myEarnings: null,
      winnerTeam: null,
      bonusRules: [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
