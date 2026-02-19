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

type RankRow = {
  worker_id: string;
  name: string;
  minutes: number;
  captadas: number;
  repite_pct: number;
  cliente_pct: number;
};

function monthStartMadridISO() {
  // YYYY-MM-01 (Europe/Madrid) como DATE string
  const now = new Date();
  // truco simple: tomamos fecha en ISO pero ajustando a Madrid con toLocaleString
  const madrid = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Madrid" })
  );
  const y = madrid.getFullYear();
  const m = String(madrid.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10; // 1 decimal
}

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    // service client: valida token + lee tablas
    const db = createClient(url, service, { auth: { persistSession: false } });

    // validar user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const uid = u.user.id;

    // worker del usuario
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!me.is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const month_date = monthStartMadridISO();

    // Traemos filas del mes + nombre/rol del worker (join manual seguro)
    const { data: rows, error: erows } = await db
      .from("attendance_rows")
      .select("worker_id, minutes, calls, codigo, captado")
      .eq("month_date", month_date)
      .limit(100000);

    if (erows) return NextResponse.json({ ok: false, error: erows.message }, { status: 500 });

    const workerIds = Array.from(new Set((rows || []).map((r: any) => r.worker_id).filter(Boolean)));

    const { data: ws, error: ews } = await db
      .from("workers")
      .select("id, display_name, role")
      .in("id", workerIds.length ? workerIds : ["00000000-0000-0000-0000-000000000000"]);

    if (ews) return NextResponse.json({ ok: false, error: ews.message }, { status: 500 });

    const wMap = new Map<string, { name: string; role: string }>();
    for (const w of ws || []) wMap.set((w as any).id, { name: (w as any).display_name, role: (w as any).role });

    // agregación
    const agg = new Map<
      string,
      {
        worker_id: string;
        name: string;
        role: string;
        minutes: number;
        calls: number;
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
          calls: 0,
          captadas: 0,
          cliente_min: 0,
          repite_min: 0,
        });
      }

      const it = agg.get(wid)!;
      const min = Number((r as any).minutes) || 0;
      const calls = Number((r as any).calls) || 0;

      it.minutes += min;
      it.calls += calls;

      if ((r as any).captado) it.captadas += 1;

      const codigo = String((r as any).codigo || "").toLowerCase();
      if (codigo === "cliente") it.cliente_min += min;
      if (codigo === "repite") it.repite_min += min;
    }

    const all = Array.from(agg.values());

    // rankings
    const tarotistas = all.filter((x) => x.role === "tarotista");

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

    const rankCaptadas: any[] = [...tarotistas]
      .sort((a, b) => b.captadas - a.captadas)
      .map((x) => ({
        worker_id: x.worker_id,
        name: x.name,
        captadas: x.captadas,
      }));

    const rankCliente: any[] = [...tarotistas]
      .sort((a, b) => pct(b.cliente_min, b.minutes) - pct(a.cliente_min, a.minutes))
      .map((x) => ({
        worker_id: x.worker_id,
        name: x.name,
        cliente_pct: pct(x.cliente_min, x.minutes),
      }));

    const rankRepite: any[] = [...tarotistas]
      .sort((a, b) => pct(b.repite_min, b.minutes) - pct(a.repite_min, a.minutes))
      .map((x) => ({
        worker_id: x.worker_id,
        name: x.name,
        repite_pct: pct(x.repite_min, x.minutes),
      }));

    // my earnings (si es tarotista/central solo como placeholder, sin romper)
    const myEarnings = null;

    return NextResponse.json({
      ok: true,
      month_date,
      user: { isAdmin: me.role === "admin", worker: me },
      rankings: {
        minutes: rankMinutes,
        repite_pct: rankRepite,
        cliente_pct: rankCliente,
        captadas: rankCaptadas,
      },
      myEarnings,
      winnerTeam: null,
      bonusRules: [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
