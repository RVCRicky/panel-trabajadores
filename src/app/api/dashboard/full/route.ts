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

type RankRow = {
  worker_id: string;
  name: string;
  minutes: number;
  captadas: number;
  repite_pct: number;
  cliente_pct: number;
};

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10; // 1 decimal
}

export async function GET(req: Request) {
  const urlObj = new URL(req.url);
  const debug = urlObj.searchParams.get("debug") === "1";

  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const db = createClient(url, service, { auth: { persistSession: false } });

    // 1) validar user (token del cliente)
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

    // 3) último mes disponible
    const { data: lastMonthRow, error: emonth } = await db
      .from("attendance_rows")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (emonth) return NextResponse.json({ ok: false, error: emonth.message }, { status: 500 });

    const month_date: string | null = (lastMonthRow as any)?.month_date || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        user: { isAdmin: normRole((me as any).role) === "admin", worker: me },
        rankings: { minutes: [], repite_pct: [], cliente_pct: [], captadas: [] },
        myEarnings: null,
        winnerTeam: null,
        bonusRules: [],
        ...(debug ? { debug: { step: "no_month_date" } } : {}),
      });
    }

    // 4) filas del mes
    const { data: rows, error: erows } = await db
      .from("attendance_rows")
      .select("worker_id, minutes, calls, codigo, captado")
      .eq("month_date", month_date)
      .limit(100000);

    if (erows) return NextResponse.json({ ok: false, error: erows.message }, { status: 500 });

    const workerIds = Array.from(new Set((rows || []).map((r: any) => r.worker_id).filter(Boolean)));

    if (workerIds.length === 0) {
      return NextResponse.json({
        ok: true,
        month_date,
        user: { isAdmin: normRole((me as any).role) === "admin", worker: me },
        rankings: { minutes: [], repite_pct: [], cliente_pct: [], captadas: [] },
        myEarnings: null,
        winnerTeam: null,
        bonusRules: [],
        ...(debug
          ? {
              debug: {
                step: "no_worker_ids",
                month_date,
                rows_count: (rows || []).length,
              },
            }
          : {}),
      });
    }

    // 5) workers de esos ids
    const { data: ws, error: ews } = await db.from("workers").select("id, display_name, role").in("id", workerIds);

    if (ews) return NextResponse.json({ ok: false, error: ews.message }, { status: 500 });

    const wMap = new Map<string, { name: string; role: string }>();
    for (const w of ws || []) {
      const id = (w as any).id as string;
      wMap.set(id, { name: (w as any).display_name, role: (w as any).role });
    }

    // 6) agregación
    const agg = new Map<
      string,
      {
        worker_id: string;
        name: string;
        role: string;
        minutes: number;
        captadas: number;
        cliente_min: number;
        repite_min: number;
      }
    >();

    for (const r of rows || []) {
      const wid = (r as any).worker_id as string;
      if (!wid) continue;

      const w = wMap.get(wid);
      if (!w) continue;

      if (!agg.has(wid)) {
        agg.set(wid, {
          worker_id: wid,
          name: w.name,
          role: w.role,
          minutes: 0,
          captadas: 0,
          cliente_min: 0,
          repite_min: 0,
        });
      }

      const it = agg.get(wid)!;
      const min = Number((r as any).minutes) || 0;

      it.minutes += min;
      if ((r as any).captado) it.captadas += 1;

      const codigo = String((r as any).codigo || "").trim().toLowerCase();
      if (codigo === "cliente") it.cliente_min += min;
      if (codigo === "repite") it.repite_min += min;
    }

    const all = Array.from(agg.values());

    // ✅ FIX: role robusto (mayúsculas/espacios)
    const tarotistas = all.filter((x) => normRole(x.role) === "tarotista");

    const rankMinutes: RankRow[] = [...tarotistas]
      .sort((a, b) => b.minutes - a.minutes)
      .map((x) => ({
        worker_id: x.worker_id,
        name: x.name,
        minutes: x.minutes,
        captadas: x.captadas,
        cliente_pct: pct(x.cliente_min, x.minutes),
        repite_pct: pct(x.repite_min, x.minutes),
      }));

    const rankCaptadas = [...tarotistas]
      .sort((a, b) => b.captadas - a.captadas)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, captadas: x.captadas }));

    const rankCliente = [...tarotistas]
      .sort((a, b) => pct(b.cliente_min, b.minutes) - pct(a.cliente_min, a.minutes))
      .map((x) => ({ worker_id: x.worker_id, name: x.name, cliente_pct: pct(x.cliente_min, x.minutes) }));

    const rankRepite = [...tarotistas]
      .sort((a, b) => pct(b.repite_min, b.minutes) - pct(a.repite_min, a.minutes))
      .map((x) => ({ worker_id: x.worker_id, name: x.name, repite_pct: pct(x.repite_min, x.minutes) }));

    return NextResponse.json({
      ok: true,
      month_date,
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
      ...(debug
        ? {
            debug: {
              month_date,
              rows_count: (rows || []).length,
              worker_ids_count: workerIds.length,
              workers_found_count: (ws || []).length,
              agg_count: all.length,
              tarotistas_count: tarotistas.length,
              roles_sample: (ws || []).slice(0, 20).map((w: any) => ({ id: w.id, role: w.role, name: w.display_name })),
            },
          }
        : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
