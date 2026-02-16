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

function monthStartISO(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function parseMonthParam(s: string | null) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // esperamos YYYY-MM-01
  return s;
}

type RankingType = "minutes" | "repite_pct" | "cliente_pct" | "captadas";

export async function GET(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = new URL(req.url);
    const monthParam = parseMonthParam(url.searchParams.get("month"));
    const month = monthParam || monthStartISO(new Date());

    // 1) validar usuario
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    // 2) DB admin (service role)
    const db = createClient(supabaseUrl, serviceKey);

    // worker de este user
    const { data: meWorker, error: wErr } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });
    if (!meWorker) return NextResponse.json({ ok: true, worker: null });

    // periodos disponibles (para selector)
    const { data: periods } = await db.from("periods").select("month_date,label").order("month_date", { ascending: false });

    // 3) traer attendance del mes (por source_date)
    // month = YYYY-MM-01
    const monthDate = new Date(`${month}T00:00:00Z`);
    const nextMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1));
    const nextMonthISO = monthStartISO(nextMonth);

    const { data: rows, error: rErr } = await db
      .from("attendance_rows")
      .select("minutes,calls,codigo,captado,worker_id,source_date,worker:workers(id,display_name,role)")
      .gte("source_date", month)
      .lt("source_date", nextMonthISO)
      .limit(100000);

    if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 400 });

    // 4) Agregar por worker
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

    for (const it of map.values()) {
      it.repite_pct = pct(it.repite, it.minutes);
      it.cliente_pct = pct(it.cliente, it.minutes);
    }

    const all = Array.from(map.values());
    const tarotistas = all.filter((x) => x.role === "tarotista");
    const centrales = all.filter((x) => x.role === "central");

    // 5) Rankings tarotistas
    const byMinutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes);
    const byRepitePct = [...tarotistas].sort((a, b) => b.repite_pct - a.repite_pct);
    const byClientePct = [...tarotistas].sort((a, b) => b.cliente_pct - a.cliente_pct);
    const byCaptadas = [...tarotistas].sort((a, b) => b.captadas - a.captadas);

    const tarotistasRankings = {
      minutes: byMinutes.slice(0, 50),
      repite_pct: byRepitePct.slice(0, 50),
      cliente_pct: byClientePct.slice(0, 50),
      captadas: byCaptadas.slice(0, 50),
    };

    // 6) Mis stats (del mes)
    const my = map.get(meWorker.id) || {
      worker_id: meWorker.id,
      name: meWorker.display_name,
      role: meWorker.role,
      minutes: 0,
      calls: 0,
      captadas: 0,
      free: 0,
      rueda: 0,
      cliente: 0,
      repite: 0,
      repite_pct: 0,
      cliente_pct: 0,
    };

    // 7) Cargar reglas de bonos
    const { data: rules, error: brErr } = await db
      .from("bonus_rules")
      .select("ranking_type,position,amount,role");

    if (brErr) return NextResponse.json({ ok: false, error: brErr.message }, { status: 400 });

    const ruleMap = new Map<string, number>(); // key: role|type|pos => amount
    for (const rr of (rules as any[]) || []) {
      const key = `${rr.role}|${rr.ranking_type}|${rr.position}`;
      ruleMap.set(key, Number(rr.amount) || 0);
    }

    // 8) Calcular bonos “teóricos” del mes (sin persistir todavía)
    // Tarotistas: top3 de cada ranking
    function top3Bonuses(list: any[], type: RankingType, role: "tarotista" | "central") {
      const out: { worker_id: string; name: string; ranking_type: string; position: number; amount: number }[] = [];
      for (let i = 0; i < Math.min(3, list.length); i++) {
        const pos = i + 1;
        const w = list[i];
        const amount = ruleMap.get(`${role}|${type}|${pos}`) || 0;
        out.push({ worker_id: w.worker_id, name: w.name, ranking_type: type, position: pos, amount });
      }
      return out;
    }

    const bonusTarotistas = [
      ...top3Bonuses(byMinutes, "minutes", "tarotista"),
      ...top3Bonuses(byRepitePct, "repite_pct", "tarotista"),
      ...top3Bonuses(byClientePct, "cliente_pct", "tarotista"),
      ...top3Bonuses(byCaptadas, "captadas", "tarotista"),
    ];

    // 9) Equipos: central_teams + team_members
    const { data: teams, error: tErr } = await db
      .from("central_teams")
      .select("id,name,central_worker_id,central:workers!central_teams_central_worker_id_fkey(id,display_name,role)")
      .eq("is_active", true);

    if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 400 });

    const { data: members, error: mErr } = await db
      .from("team_members")
      .select("team_id,tarotista_worker_id");

    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 400 });

    const teamMembers = new Map<string, string[]>(); // team_id -> tarotista_worker_ids[]
    for (const mm of (members as any[]) || []) {
      if (!teamMembers.has(mm.team_id)) teamMembers.set(mm.team_id, []);
      teamMembers.get(mm.team_id)!.push(mm.tarotista_worker_id);
    }

    // Calcular score equipo (por ahora: total minutos del equipo, captadas, y %cliente medio ponderado por minutos)
    const teamStats = (teams as any[] || []).map((t) => {
      const ids = teamMembers.get(t.id) || [];
      let minutes = 0;
      let captadas = 0;
      let cliente = 0;
      // ponderación
      for (const wid of ids) {
        const s = map.get(wid);
        if (!s) continue;
        minutes += s.minutes;
        captadas += s.captadas;
        cliente += s.cliente; // para %cliente del equipo: cliente_minutes / total_minutes
      }
      const cliente_pct = pct(cliente, minutes);

      return {
        team_id: t.id,
        team_name: t.name,
        central_worker_id: t.central_worker_id,
        central_name: t.central?.display_name || "Central",
        total_minutes: minutes,
        total_captadas: captadas,
        team_cliente_pct: cliente_pct,
      };
    });

    // Ganador equipo: por minutos (primera versión). Luego lo hacemos por fórmula compuesta si quieres.
    const teamSorted = [...teamStats].sort((a, b) => b.total_minutes - a.total_minutes);
    const winnerTeam = teamSorted[0] || null;

    // Bonus central winner
    const centralWinnerBonusAmount = ruleMap.get(`central|team_winner|1`) || 0;
    const bonusCentrales = winnerTeam
      ? [
          {
            worker_id: winnerTeam.central_worker_id,
            name: winnerTeam.central_name,
            ranking_type: "team_winner",
            position: 1,
            amount: centralWinnerBonusAmount,
            team_name: winnerTeam.team_name,
          },
        ]
      : [];

    // 10) Mis bonos (si aparezco en listas)
    const myBonuses = [
      ...bonusTarotistas.filter((b) => b.worker_id === meWorker.id),
      ...bonusCentrales.filter((b) => b.worker_id === meWorker.id),
    ];

    // 11) Mi rank por cada ranking
    function rankOf(list: any[]) {
      const idx = list.findIndex((x) => x.worker_id === meWorker.id);
      return idx === -1 ? null : idx + 1;
    }

    const myRanks = {
      minutes: rankOf(byMinutes),
      repite_pct: rankOf(byRepitePct),
      cliente_pct: rankOf(byClientePct),
      captadas: rankOf(byCaptadas),
    };

    return NextResponse.json({
      ok: true,
      month,
      periods: periods || [],
      worker: meWorker,
      my,
      myRanks,
      tarotistasRankings,
      centralesSummary: centrales.slice(0, 50),
      bonusTarotistasTop3: bonusTarotistas,
      teamStats: teamSorted,
      teamWinner: winnerTeam,
      bonusCentrales: bonusCentrales,
      myBonuses,
      note:
        "Bonos calculados en caliente (no persistidos). Equipo ganador por total_minutes (primera versión).",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
