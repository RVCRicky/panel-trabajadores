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
  return Math.round((part / total) * 10000) / 100;
}

function monthStartISO(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function nextMonthISO(month_date: string) {
  const [y, m] = month_date.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  return monthStartISO(dt);
}

export async function GET(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const url = new URL(req.url);
    const month = (url.searchParams.get("month") || "").trim();
    const month_date = month && /^\d{4}-\d{2}-\d{2}$/.test(month) ? month : monthStartISO(new Date());

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const db = createClient(supabaseUrl, serviceKey);

    // Worker del usuario
    const { data: myWorker, error: wErr } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });

    // Admin?
    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    const isAdmin = !!adminRow;

    // asegurar periodo
    await db.from("periods").upsert({ month_date, label: month_date }, { onConflict: "month_date" });

    // reglas de bonos
    const { data: rules, error: rErr } = await db.from("bonus_rules").select("ranking_type, position, amount, role");
    if (rErr) return NextResponse.json({ ok: false, error: rErr.message }, { status: 400 });

    // datos del mes
    const monthStart = month_date;
    const monthEnd = nextMonthISO(month_date);

    const { data: rows, error } = await db
      .from("attendance_rows")
      .select("source_date, minutes, codigo, captado, worker:workers(id, display_name, role)")
      .gte("source_date", monthStart)
      .lt("source_date", monthEnd)
      .limit(100000);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

    type Agg = {
      worker_id: string;
      name: string;
      role: string;
      minutes: number;
      captadas: number;
      free: number;
      rueda: number;
      cliente: number;
      repite: number;
      repite_pct: number;
      cliente_pct: number;
    };

    const map = new Map<string, Agg>();

    for (const r of (rows as any[]) || []) {
      const w = r.worker;
      if (!w) continue;

      const id = w.id as string;
      if (!map.has(id)) {
        map.set(id, {
          worker_id: id,
          name: w.display_name,
          role: w.role,
          minutes: 0,
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

    const tarotistas = Array.from(map.values()).filter((x) => x.role === "tarotista");
    const centrales = Array.from(map.values()).filter((x) => x.role === "central");

    const rank_minutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes);
    const rank_repite = [...tarotistas].sort((a, b) => b.repite_pct - a.repite_pct);
    const rank_cliente = [...tarotistas].sort((a, b) => b.cliente_pct - a.cliente_pct);
    const rank_captadas = [...tarotistas].sort((a, b) => b.captadas - a.captadas);

    const centralesByMinutes = [...centrales].sort((a, b) => b.minutes - a.minutes);

    // equipos
    const { data: teams, error: tErr } = await db.from("central_teams").select("id, name, central_worker_id, is_active");
    if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 400 });

    const { data: members, error: mErr } = await db.from("team_members").select("team_id, tarotista_worker_id");
    if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 400 });

    const teamMembers = new Map<string, string[]>();
    for (const mm of (members as any[]) || []) {
      const tid = mm.team_id as string;
      const wid = mm.tarotista_worker_id as string;
      if (!teamMembers.has(tid)) teamMembers.set(tid, []);
      teamMembers.get(tid)!.push(wid);
    }

    const teamStats = (teams as any[] || []).map((t) => {
      const tid = t.id as string;
      const wids = teamMembers.get(tid) || [];

      let total_minutes = 0;
      let total_captadas = 0;
      let total_cliente = 0;
      let total_repite = 0;

      for (const wid of wids) {
        const a = map.get(wid);
        if (!a) continue;
        total_minutes += a.minutes;
        total_captadas += a.captadas;
        total_cliente += a.cliente;
        total_repite += a.repite;
      }

      return {
        team_id: tid,
        team_name: t.name,
        central_worker_id: t.central_worker_id,
        is_active: t.is_active,
        total_minutes,
        total_captadas,
        total_cliente_pct: pct(total_cliente, total_minutes),
        total_repite_pct: pct(total_repite, total_minutes),
      };
    });

    const activeTeams = teamStats.filter((x) => x.is_active);
    activeTeams.sort((a, b) => b.total_minutes - a.total_minutes);
    const winnerTeam = activeTeams.length > 0 ? activeTeams[0] : null;

    function awardTop3(list: Agg[], ranking_type: string, role: string) {
      const out: any[] = [];
      for (let i = 0; i < Math.min(3, list.length); i++) {
        const pos = i + 1;
        const rr = (rules as any[]).find((x) => x.ranking_type === ranking_type && x.position === pos && x.role === role);
        out.push({
          ranking_type,
          position: pos,
          worker_id: list[i].worker_id,
          name: list[i].name,
          amount: rr ? Number(rr.amount) : 0,
        });
      }
      return out;
    }

    const tarotistaBonuses = [
      ...awardTop3(rank_minutes, "minutes", "tarotista"),
      ...awardTop3(rank_repite, "repite_pct", "tarotista"),
      ...awardTop3(rank_cliente, "cliente_pct", "tarotista"),
      ...awardTop3(rank_captadas, "captadas", "tarotista"),
    ];

    let centralWinnerBonus: any = null;
    if (winnerTeam) {
      const rr = (rules as any[]).find((x) => x.ranking_type === "team_win" && x.position === 1 && x.role === "central");
      centralWinnerBonus = {
        ranking_type: "team_win",
        position: 1,
        central_worker_id: winnerTeam.central_worker_id,
        team_id: winnerTeam.team_id,
        team_name: winnerTeam.team_name,
        amount: rr ? Number(rr.amount) : 0,
      };
    }

    // mis stats del mes
    let myStats: any = null;
    if (myWorker?.id) {
      const a = map.get(myWorker.id);
      myStats = a
        ? {
            minutes: a.minutes,
            captadas: a.captadas,
            repite_pct: a.repite_pct,
            cliente_pct: a.cliente_pct,
            free: a.free,
            rueda: a.rueda,
            cliente: a.cliente,
            repite: a.repite,
          }
        : {
            minutes: 0,
            captadas: 0,
            repite_pct: 0,
            cliente_pct: 0,
            free: 0,
            rueda: 0,
            cliente: 0,
            repite: 0,
          };
    }

    // mi equipo (si soy central)
    let myTeam: any = null;
    if (myWorker?.role === "central" && myWorker?.id) {
      const team = (teams as any[] || []).find((t) => t.central_worker_id === myWorker.id);
      if (team) {
        const stats = teamStats.find((x) => x.team_id === team.id) || null;
        myTeam = { team, stats };
      }
    }

    // ✅ FIX: ranks solo si existe myWorker
    function rankOf(list: Agg[], workerId: string | null) {
      if (!workerId) return null;
      const idx = list.findIndex((x) => x.worker_id === workerId);
      return idx === -1 ? null : idx + 1;
    }

    const myRanks = {
      minutes: rankOf(rank_minutes, myWorker?.id || null),
      repite_pct: rankOf(rank_repite, myWorker?.id || null),
      cliente_pct: rankOf(rank_cliente, myWorker?.id || null),
      captadas: rankOf(rank_captadas, myWorker?.id || null),
    };

    return NextResponse.json({
      ok: true,
      month_date,
      user: { worker: myWorker || null, isAdmin },
      myStats,
      myRanks,
      rankings: {
        minutes: rank_minutes.slice(0, 50),
        repite_pct: rank_repite.slice(0, 50),
        cliente_pct: rank_cliente.slice(0, 50),
        captadas: rank_captadas.slice(0, 50),
      },
      centralesRankings: {
        minutes: centralesByMinutes.slice(0, 50),
      },
      teamStats: activeTeams,
      winnerTeam,
      bonuses: {
        tarotistas: tarotistaBonuses,
        centralWinner: centralWinnerBonus,
        rules,
      },
      meta: { totalRowsMonth: (rows as any[])?.length || 0 },
      note: "Mensual por source_date. Ganador de equipo por minutos del equipo.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
