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

function safeStr(x: any) {
  return String(x ?? "").trim();
}

function uniq(arr: any[]) {
  return Array.from(new Set(arr));
}

function calcTeamScore(clientePct: number, repitePct: number) {
  const c = toNum(clientePct);
  const r = toNum(repitePct);
  return Number((c + r).toFixed(2)); // tal como lo venías mostrando
}

type RankRow = {
  worker_id: string;
  name: string;
  role: string;
  minutes: number;
  captadas: number;
  cliente_pct: number;
  repite_pct: number;
};

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

    // auth user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    const uid = u.user.id;

    // worker
    const { data: me } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const myWorkerId = String((me as any).id);
    const myRole = normRole((me as any).role);

    // month param
    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");

    // meses disponibles (FUENTE: worker_invoices)
    const { data: invoiceRows } = await db
      .from("worker_invoices")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    const months = uniq((invoiceRows || []).map((r: any) => r.month_date).filter(Boolean)) as string[];
    const month_date = monthParam || months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        user: { isAdmin: myRole === "admin", worker: me },
        rankings: {
          minutes: [],
          repite_pct: [],
          cliente_pct: [],
          captadas: [],
          eur_total: [],
          eur_bonus: [],
        },
        myEarnings: null,
        myIncidentsMonth: { count: 0, penalty_eur: 0, grave: false },
        teamsRanking: [],
        myTeamRank: null,
        winnerTeam: null,
        bonusRules: [],
      });
    }

    // ===============================
    // 1) RANKINGS (monthly_rankings)
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

    const rows: RankRow[] = (mr || [])
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

    const tarotistas = rows.filter((x) => normRole(x.role) === "tarotista");

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
    // 3) MIS GANANCIAS
    // ===============================
    const myInvoice = invoiceMap.get(myWorkerId);
    const myRankRow = rows.find((r) => r.worker_id === myWorkerId);

    const myEarnings =
      myRole === "tarotista"
        ? {
            minutes_total: toNum(myRankRow?.minutes),
            captadas: toNum(myRankRow?.captadas),
            amount_base_eur: 0,
            amount_bonus_eur: toNum(myInvoice?.bonuses_eur),
            amount_total_eur: toNum(myInvoice?.total_eur),
          }
        : {
            minutes_total: 0,
            captadas: 0,
            amount_base_eur: 0,
            amount_bonus_eur: 0,
            amount_total_eur: 0,
          };

    // ===============================
    // 4) INCIDENCIAS DEL MES (solo unjustified)
    // ===============================
    let myIncidentsMonth = { count: 0, penalty_eur: 0, grave: false };

    try {
      const { data: incs } = await db
        .from("shift_incidents")
        .select("id, kind, status, penalty_eur")
        .eq("worker_id", myWorkerId)
        .eq("month_date", month_date)
        .eq("status", "unjustified")
        .limit(5000);

      if (Array.isArray(incs)) {
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
    // 5) BONUS RULES
    // ===============================
    let bonusRules: any[] = [];
    try {
      const { data: br } = await db
        .from("bonus_rules")
        .select("ranking_type, position, role, amount_eur, created_at, is_active")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (Array.isArray(br)) bonusRules = br;
    } catch {
      bonusRules = [];
    }

    // ===============================
    // 6) CENTRAL: EQUIPOS (CALC EN VIVO)
    // ===============================
    let teamsRanking: TeamRow[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    if (myRole === "central") {
      const adb: any = db as any;

      // 6.1) leer equipos
      const { data: teamsRows } = await adb.from("teams").select("*").limit(5000);
      const teamsAll = Array.isArray(teamsRows) ? teamsRows : [];

      const teamNameMap = new Map<string, string>();
      for (const t of teamsAll) {
        const id = safeStr(t?.id || t?.team_id);
        if (!id) continue;
        const nm = safeStr(t?.team_name || t?.name || t?.display_name || t?.title) || `Equipo ${id.slice(0, 6)}`;
        teamNameMap.set(id, nm);
      }

      // 6.2) leer miembros (team_members)
      const { data: memRows } = await adb
        .from("team_members")
        .select("team_id, worker_id, workers:workers(id, display_name)")
        .limit(20000);

      const members = Array.isArray(memRows) ? memRows : [];

      const teamToMembers = new Map<string, TeamMember[]>();
      const teamToWorkerIds = new Map<string, string[]>();

      for (const r of members) {
        const tid = safeStr(r?.team_id);
        const wid = safeStr(r?.worker_id);
        if (!tid || !wid) continue;

        const nm = r?.workers?.display_name || wid.slice(0, 8);

        const arr = teamToMembers.get(tid) || [];
        arr.push({ worker_id: wid, name: nm });
        teamToMembers.set(tid, arr);

        const ids = teamToWorkerIds.get(tid) || [];
        ids.push(wid);
        teamToWorkerIds.set(tid, ids);
      }

      // 6.3) traer monthly_rankings de TODAS las worker_id (solo las que están en teams)
      const allWorkerIds = uniq(
        Array.from(teamToWorkerIds.values()).flat().filter(Boolean)
      ) as string[];

      let rankRows: any[] = [];
      if (allWorkerIds.length) {
        // si son muchos, supabase soporta .in con lista grande, pero por seguridad troceamos
        const chunk = (arr: string[], size: number) => {
          const out: string[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };

        const chunks = chunk(allWorkerIds, 800);
        const tmp: any[] = [];
        for (const c of chunks) {
          const { data: rr } = await adb
            .from("monthly_rankings")
            .select("worker_id, minutes_total, captadas_total, cliente_pct, repite_pct")
            .eq("month_date", month_date)
            .in("worker_id", c)
            .limit(5000);

          if (Array.isArray(rr)) tmp.push(...rr);
        }
        rankRows = tmp;
      }

      const workerRankMap = new Map<string, any>();
      for (const r of rankRows) workerRankMap.set(String(r.worker_id), r);

      // 6.4) traer invoices para sumar € por equipo (sin “tocar facturación”, solo sumar lo que ya existe)
      let invRows: any[] = [];
      if (allWorkerIds.length) {
        const chunk = (arr: string[], size: number) => {
          const out: string[][] = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };

        const chunks = chunk(allWorkerIds, 800);
        const tmp: any[] = [];
        for (const c of chunks) {
          const { data: ii } = await adb
            .from("worker_invoices")
            .select("worker_id, total_eur")
            .eq("month_date", month_date)
            .in("worker_id", c)
            .limit(5000);

          if (Array.isArray(ii)) tmp.push(...ii);
        }
        invRows = tmp;
      }

      const workerEurMap = new Map<string, number>();
      for (const r of invRows) workerEurMap.set(String(r.worker_id), toNum(r.total_eur));

      // 6.5) calcular por equipo (ponderado por minutos, para que sea “real”)
      const computed: TeamRow[] = [];
      for (const [team_id, ids] of teamToWorkerIds.entries()) {
        const team_name = teamNameMap.get(team_id) || `Equipo ${team_id.slice(0, 6)}`;
        const ms = teamToMembers.get(team_id) || [];

        let total_minutes = 0;
        let total_captadas = 0;
        let total_eur_month = 0;

        // ponderaciones para %Clientes y %Repite
        let wMin = 0;
        let sumCliW = 0;
        let sumRepW = 0;

        // fallback simple avg si no hay minutos
        let nPct = 0;
        let sumCli = 0;
        let sumRep = 0;

        for (const wid of ids) {
          const rr = workerRankMap.get(wid);
          const mins = toNum(rr?.minutes_total);
          const caps = toNum(rr?.captadas_total);
          const cli = toNum(rr?.cliente_pct);
          const rep = toNum(rr?.repite_pct);

          total_minutes += mins;
          total_captadas += caps;

          const eurw = toNum(workerEurMap.get(wid));
          total_eur_month += eurw;

          if (mins > 0) {
            wMin += mins;
            sumCliW += cli * mins;
            sumRepW += rep * mins;
          }

          if (cli || rep) {
            nPct += 1;
            sumCli += cli;
            sumRep += rep;
          }
        }

        const team_cliente_pct =
          wMin > 0 ? sumCliW / wMin : nPct > 0 ? sumCli / nPct : 0;

        const team_repite_pct =
          wMin > 0 ? sumRepW / wMin : nPct > 0 ? sumRep / nPct : 0;

        const team_score = calcTeamScore(team_cliente_pct, team_repite_pct);

        computed.push({
          team_id,
          team_name,
          total_eur_month: Number(total_eur_month.toFixed(2)),
          total_minutes,
          total_captadas,
          member_count: ms.length,
          team_cliente_pct: Number(team_cliente_pct.toFixed(2)),
          team_repite_pct: Number(team_repite_pct.toFixed(2)),
          team_score,
          members: ms,
        });
      }

      computed.sort((a, b) => toNum(b.team_score) - toNum(a.team_score));
      teamsRanking = computed.slice(0, 10);

      // 6.6) mi equipo (por team_members: worker_id = mi worker)
      let myTeamId: string | null = null;
      try {
        const { data: mine } = await adb.from("team_members").select("team_id").eq("worker_id", myWorkerId).limit(1);
        const row = Array.isArray(mine) ? mine[0] : null;
        myTeamId = row?.team_id ? String(row.team_id) : null;
      } catch {
        myTeamId = null;
      }

      if (myTeamId) {
        const idx = teamsRanking.findIndex((t) => t.team_id === myTeamId);
        myTeamRank = idx === -1 ? null : idx + 1;
      } else {
        myTeamRank = null;
      }

      const win = teamsRanking[0] || null;
      winnerTeam = win
        ? {
            team_id: win.team_id,
            team_name: win.team_name,
            total_minutes: win.total_minutes,
            total_captadas: win.total_captadas,
            total_eur_month: win.total_eur_month,
            team_score: win.team_score,
          }
        : null;

      // 6.7) bono ganador (bonus_rules: ranking_type=team_winner)
      const ruleWinner = (bonusRules || []).find(
        (x: any) =>
          String(x?.ranking_type || "").toLowerCase() === "team_winner" &&
          Number(x?.position) === 1 &&
          String(x?.role || "").toLowerCase() === "central" &&
          (x?.is_active === undefined ? true : !!x?.is_active)
      );
      const bonusTeamWinner = ruleWinner ? toNum(ruleWinner.amount_eur) : 0;

      // 6.8) setear bono en myEarnings si su equipo va #1
      const centralBonus = myTeamRank === 1 ? bonusTeamWinner : 0;
      (myEarnings as any).amount_bonus_eur = centralBonus;
      (myEarnings as any).amount_total_eur = centralBonus;
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

      teamsRanking,
      myTeamRank,
      winnerTeam,
      bonusRules,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
