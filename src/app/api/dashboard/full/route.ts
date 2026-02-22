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

function toNum(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

type TeamMember = { worker_id: string; name: string };

type TeamRow = {
  team_id: string;
  team_name: string;
  total_eur_month: number;
  total_minutes: number;
  total_captadas: number;
  member_count: number;

  team_cliente_pct?: number;
  team_repite_pct?: number;
  team_score?: number;

  members?: TeamMember[];
};

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const uid = u.user.id;

    const { data: me } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!me.is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const myWorkerId = String(me.id);
    const myRole = normRole(me.role);

    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");

    const { data: invoiceRows } = await db
      .from("worker_invoices")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    const months = Array.from(new Set((invoiceRows || []).map((r: any) => r.month_date).filter(Boolean)));
    const month_date = monthParam || months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        user: { isAdmin: myRole === "admin", worker: me },
        rankings: {},
        myEarnings: null,
        myIncidentsMonth: { count: 0, penalty_eur: 0, grave: false },
        teamsRanking: [],
        myTeamRank: null,
        winnerTeam: null,
        bonusRules: [],
      });
    }

    // ===============================
    // 1) RANKINGS (tarotistas) — igual
    // ===============================
    const { data: mr } = await db
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

    const rows = (mr || [])
      .map((x: any) => ({
        worker_id: String(x.worker_id),
        name: x.workers?.display_name || "—",
        role: x.workers?.role || "",
        minutes: toNum(x.minutes_total),
        captadas: toNum(x.captadas_total),
        cliente_pct: toNum(x.cliente_pct),
        repite_pct: toNum(x.repite_pct),
      }))
      .filter((x: any) => x.worker_id);

    const tarotistas = rows.filter((x: any) => normRole(x.role) === "tarotista");

    const rankMinutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes);
    const rankCaptadas = [...tarotistas].sort((a, b) => b.captadas - a.captadas);
    const rankCliente = [...tarotistas].sort((a, b) => b.cliente_pct - a.cliente_pct);
    const rankRepite = [...tarotistas].sort((a, b) => b.repite_pct - a.repite_pct);

    // ===============================
    // 2) FACTURAS (FUENTE REAL DE €)
    // ===============================
    const { data: invoices } = await db
      .from("worker_invoices")
      .select("worker_id, total_eur, bonuses_eur")
      .eq("month_date", month_date);

    const invoiceMap = new Map<string, any>();
    for (const inv of invoices || []) invoiceMap.set(String((inv as any).worker_id), inv);

    const rankEurTotal = [...tarotistas]
      .map((t) => ({
        worker_id: t.worker_id,
        name: t.name,
        eur_total: toNum(invoiceMap.get(t.worker_id)?.total_eur),
      }))
      .sort((a, b) => b.eur_total - a.eur_total);

    const rankEurBonus = [...tarotistas]
      .map((t) => ({
        worker_id: t.worker_id,
        name: t.name,
        eur_bonus: toNum(invoiceMap.get(t.worker_id)?.bonuses_eur),
      }))
      .sort((a, b) => b.eur_bonus - a.eur_bonus);

    // ===============================
    // 3) MIS GANANCIAS (desde factura)
    // ===============================
    const myInvoice = invoiceMap.get(myWorkerId);
    const myRankRow = rows.find((r) => r.worker_id === myWorkerId);

    const myEarnings = {
      minutes_total: toNum(myRankRow?.minutes),
      captadas: toNum(myRankRow?.captadas),
      amount_base_eur: 0,
      amount_bonus_eur: toNum(myInvoice?.bonuses_eur),
      amount_total_eur: toNum(myInvoice?.total_eur),
    };

    // ===============================
    // 4) INCIDENCIAS DEL MES (solo unjustified)
    // ===============================
    let myIncidentsMonth = { count: 0, penalty_eur: 0, grave: false };

    try {
      const { data: incs, error: eInc } = await db
        .from("shift_incidents")
        .select("id, kind, status, penalty_eur")
        .eq("worker_id", myWorkerId)
        .eq("month_date", month_date)
        .eq("status", "unjustified")
        .limit(5000);

      if (!eInc && Array.isArray(incs)) {
        const count = incs.length;
        const penalty = incs.reduce((sum, x: any) => sum + toNum(x?.penalty_eur), 0);
        const hasAbsence = incs.some((x: any) => String(x?.kind || "").toLowerCase() === "absence");
        const grave = count >= 5 || hasAbsence;

        myIncidentsMonth = {
          count,
          penalty_eur: Number(penalty.toFixed(2)),
          grave,
        };
      }
    } catch {}

    // ===============================
    // 5) BONUS RULES (para central panel)
    // ===============================
    let bonusRules: any[] = [];
    try {
      const { data: br } = await db
        .from("bonus_rules")
        .select("ranking_type, position, role, amount_eur, created_at, is_active")
        .order("ranking_type", { ascending: true })
        .order("position", { ascending: true })
        .limit(5000);

      bonusRules = (br || []).map((x: any) => ({
        ranking_type: x.ranking_type,
        position: x.position,
        role: x.role,
        amount_eur: x.amount_eur,
        created_at: x.created_at,
        is_active: x.is_active,
      }));
    } catch {
      bonusRules = [];
    }

    // ===============================
    // 6) TEAMS RANKING (GLOBAL) + winner + myTeamRank
    //    score = team_cliente_pct + team_repite_pct
    // ===============================
    let teamsRanking: TeamRow[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    try {
      // teams list
      const { data: tRows } = await db.from("teams").select("id, name").limit(2000);
      const teams = (tRows || []).map((t: any) => ({ id: String(t.id), name: String(t.name || "—") }));

      // members: team_members(worker_id, team_id)
      const { data: tmRows } = await db.from("team_members").select("team_id, worker_id").limit(20000);

      const byTeam = new Map<string, string[]>();
      for (const r of tmRows || []) {
        const tid = String((r as any).team_id || "");
        const wid = String((r as any).worker_id || "");
        if (!tid || !wid) continue;
        if (!byTeam.has(tid)) byTeam.set(tid, []);
        byTeam.get(tid)!.push(wid);
      }

      // map worker_id -> name
      const { data: wRows } = await db.from("workers").select("id, display_name, role, is_active").eq("is_active", true).limit(5000);
      const wMap = new Map<string, { name: string; role: string }>();
      for (const w of wRows || []) wMap.set(String((w as any).id), { name: String((w as any).display_name || "").trim() || String((w as any).id).slice(0, 8), role: String((w as any).role || "") });

      // build team rows using monthly_rankings rows (tarotistas only)
      const rMap = new Map<string, any>();
      for (const r of tarotistas) rMap.set(String(r.worker_id), r);

      const nextTeams: TeamRow[] = [];
      for (const t of teams) {
        const memberIds = (byTeam.get(t.id) || []).filter((wid) => normRole(wMap.get(wid)?.role) === "tarotista");
        const members: TeamMember[] = memberIds.map((wid) => ({ worker_id: wid, name: wMap.get(wid)?.name || wid.slice(0, 8) }));

        if (memberIds.length === 0) {
          nextTeams.push({
            team_id: t.id,
            team_name: t.name,
            total_eur_month: 0,
            total_minutes: 0,
            total_captadas: 0,
            member_count: 0,
            team_cliente_pct: 0,
            team_repite_pct: 0,
            team_score: 0,
            members,
          });
          continue;
        }

        let sumMin = 0;
        let sumCap = 0;
        let sumCli = 0;
        let sumRep = 0;
        let count = 0;

        let sumEur = 0;
        for (const wid of memberIds) {
          const rr = rMap.get(wid);
          if (!rr) continue;
          sumMin += toNum(rr.minutes);
          sumCap += toNum(rr.captadas);
          sumCli += toNum(rr.cliente_pct);
          sumRep += toNum(rr.repite_pct);
          count += 1;

          const inv = invoiceMap.get(wid);
          sumEur += toNum(inv?.total_eur);
        }

        const team_cliente_pct = count ? Number((sumCli / count).toFixed(2)) : 0;
        const team_repite_pct = count ? Number((sumRep / count).toFixed(2)) : 0;
        const team_score = Number((team_cliente_pct + team_repite_pct).toFixed(2));

        nextTeams.push({
          team_id: t.id,
          team_name: t.name,
          total_eur_month: Number(sumEur.toFixed(2)),
          total_minutes: Math.round(sumMin),
          total_captadas: Math.round(sumCap),
          member_count: count,
          team_cliente_pct,
          team_repite_pct,
          team_score,
          members,
        });
      }

      teamsRanking = nextTeams.sort((a, b) => (b.team_score || 0) - (a.team_score || 0)).slice(0, 2);

      // winnerTeam = top 1
      const top = teamsRanking[0] || null;
      if (top) {
        winnerTeam = {
          team_id: top.team_id,
          team_name: top.team_name,
          central_user_id: null,
          central_name: null,
          total_minutes: top.total_minutes,
          total_captadas: top.total_captadas,
          total_eur_month: top.total_eur_month,
          team_score: top.team_score,
        };
      }

      // myTeamRank: resolver central_teams -> team_id
      // Intentos robustos (si alguna columna no existe, se ignora)
      let myTeamId: string | null = null;

      const tryGetTeam = async (sel: string, eqCol: string, eqVal: string) => {
        try {
          const { data } = await db.from("central_teams").select(sel).eq(eqCol as any, eqVal as any).limit(5);
          const row = (data || [])[0] as any;
          if (!row) return null;
          const tid = String(row.team_id || row.team || row.teamid || "").trim();
          return tid || null;
        } catch {
          return null;
        }
      };

      // intentos típicos:
      myTeamId =
        (await tryGetTeam("team_id", "central_user_id", uid)) ||
        (await tryGetTeam("team_id", "user_id", uid)) ||
        (await tryGetTeam("team_id", "central_worker_id", myWorkerId)) ||
        null;

      if (myTeamId) {
        const idx = teamsRanking.findIndex((t) => String(t.team_id) === String(myTeamId));
        myTeamRank = idx === -1 ? null : idx + 1;
      } else {
        myTeamRank = null;
      }
    } catch {
      teamsRanking = [];
      myTeamRank = null;
      winnerTeam = null;
    }

    return NextResponse.json({
      ok: true,
      month_date,
      months,
      user: { isAdmin: myRole === "admin", worker: me },
      rankings: {
        minutes: rankMinutes,
        repite_pct: rankRepite,
        cliente_pct: rankCliente,
        captadas: rankCaptadas,
        eur_total: rankEurTotal,
        eur_bonus: rankEurBonus,
      },
      myEarnings,
      myIncidentsMonth,

      // ✅ extras central
      teamsRanking,
      myTeamRank,
      winnerTeam,
      bonusRules,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
