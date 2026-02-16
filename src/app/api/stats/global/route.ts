import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function pct(part: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100; // 2 decimales
}

export async function GET() {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(supabaseUrl, serviceKey);

    const { data: rows, error } = await db
      .from("attendance_rows")
      .select("minutes,calls,codigo,captado,worker:workers(id,display_name,role)")
      .order("id", { ascending: false })
      .limit(50000);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    const map = new Map<
      string,
      {
        worker_id: string;
        name: string;
        role: string;
        minutes: number;
        calls: number;
        captadas: number;
        free: number;
        rueda: number;
        cliente: number;
        repite: number;
        repite_pct: number;
        cliente_pct: number;
      }
    >();

    for (const r of (rows as any[]) || []) {
      const w = r.worker;
      if (!w) continue;

      const id = w.id;
      if (!map.has(id)) {
        map.set(id, {
          worker_id: id,
          name: w.display_name,
          role: w.role,
          minutes: 0,
          calls: 0,
          captadas: 0,
          free: 0,
          rueda: 0,
          cliente: 0,
          repite: 0,
          repite_pct: 0,
          cliente_pct: 0,
        });
      }

      const it = map.get(id)!;
      const mins = Number(r.minutes) || 0;

      it.minutes += mins;
      it.calls += Number(r.calls) || 0;
      if (r.captado) it.captadas += 1;

      if (r.codigo === "free") it.free += mins;
      if (r.codigo === "rueda") it.rueda += mins;
      if (r.codigo === "cliente") it.cliente += mins;
      if (r.codigo === "repite") it.repite += mins;
    }

    // calcular % sobre minutos totales
    for (const it of map.values()) {
      it.repite_pct = pct(it.repite, it.minutes);
      it.cliente_pct = pct(it.cliente, it.minutes);
    }

    const all = Array.from(map.values());
    const tarotistas = all.filter((x) => x.role === "tarotista");
    const centrales = all.filter((x) => x.role === "central");

    // 4 rankings tarotistas
    const tarotistasByMinutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes);
    const tarotistasByRepitePct = [...tarotistas].sort((a, b) => b.repite_pct - a.repite_pct);
    const tarotistasByClientePct = [...tarotistas].sort((a, b) => b.cliente_pct - a.cliente_pct);
    const tarotistasByCaptadas = [...tarotistas].sort((a, b) => b.captadas - a.captadas);

    // (por ahora) centrales por minutos, luego haremos por equipos
    const centralesByMinutes = [...centrales].sort((a, b) => b.minutes - a.minutes);

    return NextResponse.json({
      ok: true,
      totalRows: (rows as any[])?.length || 0,

      tarotistasRankings: {
        minutes: tarotistasByMinutes.slice(0, 50),
        repite_pct: tarotistasByRepitePct.slice(0, 50),
        cliente_pct: tarotistasByClientePct.slice(0, 50),
        captadas: tarotistasByCaptadas.slice(0, 50),
      },

      centralesRankings: {
        minutes: centralesByMinutes.slice(0, 50),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
