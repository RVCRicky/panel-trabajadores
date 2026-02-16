import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET() {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(supabaseUrl, serviceKey);

    // Traemos filas ya importadas
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

    const all = Array.from(map.values());

    const tarotistas = all.filter((x) => x.role === "tarotista").sort((a, b) => b.minutes - a.minutes);
    const centrales = all.filter((x) => x.role === "central").sort((a, b) => b.minutes - a.minutes);

    return NextResponse.json({
      ok: true,
      tarotistasTop: tarotistas.slice(0, 50),
      centralesTop: centrales.slice(0, 50),
      totalRows: (rows as any[])?.length || 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
