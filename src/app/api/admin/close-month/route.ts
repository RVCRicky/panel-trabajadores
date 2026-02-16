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

async function computeAndClose(db: any, month_date: string, closed_by: string | null, source: "manual" | "cron") {
  // ¿ya cerrado?
  const { data: closure } = await db
    .from("period_closures")
    .select("month_date,is_closed")
    .eq("month_date", month_date)
    .maybeSingle();

  if (closure?.is_closed) {
    return { ok: true, alreadyClosed: true };
  }

  // asegurar period
  await db.from("periods").upsert({ month_date, label: month_date }, { onConflict: "month_date" });

  const monthStart = month_date;
  const monthEnd = nextMonthISO(month_date);

  // attendance del mes
  const { data: rows, error } = await db
    .from("attendance_rows")
    .select("source_date, minutes, codigo, captado, worker:workers(id, display_name, role)")
    .gte("source_date", monthStart)
    .lt("source_date", monthEnd)
    .limit(200000);

  if (error) throw new Error(error.message);

  // bonus rules
  const { data: rules, error: rErr } = await db.from("bonus_rules").select("ranking_type, position, amount, role");
  if (rErr) throw new Error(rErr.message);

  // teams + members
  const { data: teams, error: tErr } = await db.from("central_teams").select("id, name, central_worker_id, is_active");
  if (tErr) throw new Error(tErr.message);

  const { data: members, error: mErr } = await db.from("team_members").select("team_id, tarotista_worker_id");
  if (mErr) throw new Error(mErr.message);

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

  const rank_minutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes);
  const rank_repite = [...tarotistas].sort((a, b) => b.repite_pct - a.repite_pct);
  const rank_cliente = [...tarotistas].sort((a, b) => b.cliente_pct - a.cliente_pct);
  const rank_captadas = [...tarotistas].sort((a, b) => b.captadas - a.captadas);

  // snapshots: top 50
  const snapshots: any[] = [];
  const pushSnap = (ranking_type: string, list: Agg[], valueFn: (a: Agg) => number) => {
    for (let i = 0; i < Math.min(50, list.length); i++) {
      snapshots.push({
        month_date,
        ranking_type,
        position: i + 1,
        worker_id: list[i].worker_id,
        value_num: valueFn(list[i]),
      });
    }
  };

  pushSnap("minutes", rank_minutes, (a) => a.minutes);
  pushSnap("repite_pct", rank_repite, (a) => a.repite_pct);
  pushSnap("cliente_pct", rank_cliente, (a) => a.cliente_pct);
  pushSnap("captadas", rank_captadas, (a) => a.captadas);

  // limpiar snapshots previos del mes (por si estaba medio hecho)
  await db.from("monthly_rankings").delete().eq("month_date", month_date);
  if (snapshots.length) await db.from("monthly_rankings").insert(snapshots);

  // bonos top3 por ranking (tarotista)
  function awardTop3(list: Agg[], ranking_type: string) {
    const out: any[] = [];
    for (let i = 0; i < Math.min(3, list.length); i++) {
      const pos = i + 1;
      const rr = (rules as any[]).find((x) => x.ranking_type === ranking_type && x.position === pos && x.role === "tarotista");
      out.push({
        month_date,
        worker_id: list[i].worker_id,
        ranking_type,
        position: pos,
        amount: rr ? Number(rr.amount) : 0,
      });
    }
    return out;
  }

  const bonusRows = [
    ...awardTop3(rank_minutes, "minutes"),
    ...awardTop3(rank_repite, "repite_pct"),
    ...awardTop3(rank_cliente, "cliente_pct"),
    ...awardTop3(rank_captadas, "captadas"),
  ];

  await db.from("monthly_bonus_results").delete().eq("month_date", month_date);
  if (bonusRows.length) await db.from("monthly_bonus_results").insert(bonusRows);

  // equipos stats y ganador por minutos
  const teamMembers = new Map<string, string[]>();
  for (const mm of (members as any[]) || []) {
    const tid = mm.team_id as string;
    const wid = mm.tarotista_worker_id as string;
    if (!teamMembers.has(tid)) teamMembers.set(tid, []);
    teamMembers.get(tid)!.push(wid);
  }

  const teamStats = (teams as any[] || [])
    .filter((t) => t.is_active)
    .map((t) => {
      const tid = t.id as string;
      const wids = teamMembers.get(tid) || [];
      let total_minutes = 0;
      let total_captadas = 0;
      let total_cliente = 0;

      for (const wid of wids) {
        const a = map.get(wid);
        if (!a) continue;
        total_minutes += a.minutes;
        total_captadas += a.captadas;
        total_cliente += a.cliente;
      }

      return {
        team_id: tid,
        total_minutes,
        total_captadas,
        total_cliente_pct: pct(total_cliente, total_minutes),
      };
    })
    .sort((a, b) => b.total_minutes - a.total_minutes);

  const winnerTeam = teamStats.length ? teamStats[0] : null;

  const teamMonthRows = teamStats.map((t) => ({
    month_date,
    team_id: t.team_id,
    total_minutes: t.total_minutes,
    total_captadas: t.total_captadas,
    total_cliente_pct: t.total_cliente_pct,
    is_winner: winnerTeam ? t.team_id === winnerTeam.team_id : false,
  }));

  await db.from("team_monthly_results").delete().eq("month_date", month_date);
  if (teamMonthRows.length) await db.from("team_monthly_results").insert(teamMonthRows);

  // bono central por equipo ganador
  if (winnerTeam) {
    const winnerTeamFull = (teams as any[]).find((x) => x.id === winnerTeam.team_id);
    const centralId = winnerTeamFull?.central_worker_id;

    const rr = (rules as any[]).find((x) => x.ranking_type === "team_win" && x.position === 1 && x.role === "central");
    const amount = rr ? Number(rr.amount) : 0;

    if (centralId) {
      // añadimos también al monthly_bonus_results como "team_win"
      await db.from("monthly_bonus_results").insert([
        { month_date, worker_id: centralId, ranking_type: "team_win", position: 1, amount },
      ]);
    }
  }

  // marcar cierre
  await db.from("period_closures").upsert(
    {
      month_date,
      is_closed: true,
      closed_at: new Date().toISOString(),
      closed_by,
      source,
      note: null,
    },
    { onConflict: "month_date" }
  );

  return { ok: true, alreadyClosed: false };
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await userClient.auth.getUser();
    const uid = u?.user?.id || null;
    if (!uid) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const db = createClient(supabaseUrl, serviceKey);

    // solo admin
    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", uid).maybeSingle();
    if (!adminRow) return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const month_date = (body?.month_date || "").trim() || monthStartISO(new Date());

    const result = await computeAndClose(db, month_date, uid, "manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
