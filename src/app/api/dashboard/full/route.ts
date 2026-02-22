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
  return Number((c + r).toFixed(2));
}

function looksLikeUuid(x: any) {
  const s = String(x || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
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

async function safeEqFirst(adb: any, table: string, selectCols: string, candidates: Array<{ col: string; val: any }>) {
  for (const c of candidates) {
    try {
      const { data, error } = await adb.from(table).select(selectCols).eq(c.col, c.val).limit(1);
      if (!error && Array.isArray(data) && data[0]) return data[0];
    } catch {}
  }
  return null;
}

function extractWorkerIdFromTeamMemberRow(row: any): string | null {
  if (!row || typeof row !== "object") return null;

  // candidatos típicos
  const candidates = [
    "worker_id",
    "member_worker_id",
    "tarotist_worker_id",
    "tarotista_worker_id",
    "worker",
    "workerid",
    "member_id",
    "member",
    "user_worker_id",
    "profile_worker_id",
  ];

  for (const k of candidates) {
    const v = row[k];
    if (looksLikeUuid(v)) return String(v);
  }

  // heurística: cualquier columna que contenga "worker" y sea uuid
  for (const [k, v] of Object.entries(row)) {
    if (String(k).toLowerCase().includes("worker") && looksLikeUuid(v)) return String(v);
  }

  // último intento: primera uuid que no sea team_id/id
  for (const [k, v] of Object.entries(row)) {
    const kk = String(k).toLowerCase();
    if (kk === "id" || kk === "team_id" || kk === "team") continue;
    if (looksLikeUuid(v)) return String(v);
  }

  return null;
}

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
    // 6) CENTRAL: EQUIPOS (REAL: team_members + monthly_rankings + invoices)
    // ===============================
    let teamsRanking: TeamRow[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    if (myRole === "central") {
      const adb: any = db as any;

      // 6.1) leer teams (nombres)
      let teamsRows: any[] = [];
      try {
        const { data, error } = await adb.from("teams").select("*").limit(5000);
        if (!error && Array.isArray(data)) teamsRows = data;
      } catch {
        teamsRows = [];
      }

      const teamNameMap = new Map<string, string>();
      for (const t of teamsRows) {
        const id = safeStr(t?.id || t?.team_id || t?.uuid);
        if (!id) continue;
        const name = safeStr(t?.team_name || t?.name || t?.display_name || t?.title) || `Equipo ${id.slice(0, 6)}`;
        teamNameMap.set(id, name);
      }

      // 6.2) leer team_members (sin asumir columnas)
      let memberRows: any[] = [];
      try {
        const { data, error } = await adb.from("team_members").select("*").limit(10000);
        if (!error && Array.isArray(data)) memberRows = data;
      } catch {
        memberRows = [];
      }

      const teamToWorkerIds = new Map<string, string[]>();
      for (const r of memberRows || []) {
        const tid = safeStr((r as any)?.team_id || (r as any)?.team || (r as any)?.teamid);
        if (!tid) continue;

        const wid = extractWorkerIdFromTeamMemberRow(r);
        if (!wid) continue;

        const arr = teamToWorkerIds.get(tid) || [];
        arr.push(wid);
        teamToWorkerIds.set(tid, arr);
      }

      // 6.3) ranking por equipo desde monthly_rankings del mes
      // (ponderamos % por minutos para que sea “real”)
      const mrByWorker = new Map<string, any>();
      for (const r of mr || []) {
        const wid = String((r as any).worker_id || "");
        if (wid) mrByWorker.set(wid, r);
      }

      const invByWorker = invoiceMap; // ya lo tenemos (worker_invoices del mes)

      const computedTeams: TeamRow[] = [];
      for (const [team_id, rawWids] of teamToWorkerIds.entries()) {
        const wids = uniq(rawWids).filter(Boolean);

        let total_minutes = 0;
        let total_captadas = 0;
        let total_eur_month = 0;

        let sumCli = 0;
        let sumRep = 0;
        let wCli = 0;
        let wRep = 0;

        for (const wid of wids) {
          const rr: any = mrByWorker.get(wid);
          const minutes = toNum(rr?.minutes_total);
          const capt = toNum(rr?.captadas_total);
          const cli = toNum(rr?.cliente_pct);
          const rep = toNum(rr?.repite_pct);

          total_minutes += minutes;
          total_captadas += capt;

          // ponderación por minutos (si no hay minutos, peso 1)
          const w = minutes > 0 ? minutes : 1;
          sumCli += cli * w;
          sumRep += rep * w;
          wCli += w;
          wRep += w;

          total_eur_month += toNum(invByWorker.get(wid)?.total_eur);
        }

        const team_cliente_pct = wCli > 0 ? Number((sumCli / wCli).toFixed(2)) : 0;
        const team_repite_pct = wRep > 0 ? Number((sumRep / wRep).toFixed(2)) : 0;

        const team_score = calcTeamScore(team_cliente_pct, team_repite_pct);

        const team_name = teamNameMap.get(team_id) || `Equipo ${team_id.slice(0, 6)}`;

        computedTeams.push({
          team_id,
          team_name,
          total_eur_month: Number(total_eur_month.toFixed(2)),
          total_minutes: Number(total_minutes.toFixed(0)),
          total_captadas: Number(total_captadas.toFixed(0)),
          member_count: wids.length,
          team_cliente_pct,
          team_repite_pct,
          team_score,
          members: [], // rellenamos luego top 2
        });
      }

      computedTeams.sort((a, b) => toNum(b.team_score) - toNum(a.team_score));
      teamsRanking = computedTeams.slice(0, 10);

      // 6.4) miembros para top 2 (sacamos nombres desde workers)
      try {
        const topIds = teamsRanking.slice(0, 2).map((t) => t.team_id);
        if (topIds.length) {
          const neededWids = uniq(
            topIds.flatMap((tid) => teamToWorkerIds.get(tid) || [])
          ).filter(Boolean);

          let workersRows: any[] = [];
          if (neededWids.length) {
            const { data, error } = await adb
              .from("workers")
              .select("id, display_name")
              .in("id", neededWids)
              .limit(10000);

            if (!error && Array.isArray(data)) workersRows = data;
          }

          const widToName = new Map<string, string>();
          for (const w of workersRows) {
            widToName.set(String(w?.id), String(w?.display_name || "").trim() || String(w?.id).slice(0, 8));
          }

          teamsRanking = teamsRanking.map((t) => {
            if (!topIds.includes(t.team_id)) return t;
            const wids = uniq(teamToWorkerIds.get(t.team_id) || []).filter(Boolean);
            const members: TeamMember[] = wids.map((wid) => ({ worker_id: wid, name: widToName.get(wid) || wid.slice(0, 8) }));
            return { ...t, members, member_count: members.length };
          });
        }
      } catch {}

      // 6.5) mi equipo (central): intentamos teams.central_* o si el central está en team_members
      let myTeamId: string | null = null;

      // a) por columnas en teams
      const myTeamRow =
        (await safeEqFirst(adb, "teams", "*", [
          { col: "central_user_id", val: uid },
          { col: "central_worker_id", val: myWorkerId },
          { col: "user_id", val: uid },
          { col: "worker_id", val: myWorkerId },
        ])) || null;

      myTeamId = safeStr(myTeamRow?.id || myTeamRow?.team_id) || null;

      // b) si no existe, buscamos si el central aparece en team_members (según columna real)
      if (!myTeamId) {
        for (const r of memberRows || []) {
          const tid = safeStr((r as any)?.team_id || (r as any)?.team || (r as any)?.teamid);
          if (!tid) continue;
          const wid = extractWorkerIdFromTeamMemberRow(r);
          if (wid && wid === myWorkerId) {
            myTeamId = tid;
            break;
          }
        }
      }

      if (myTeamId) {
        const idx = teamsRanking.findIndex((t) => t.team_id === myTeamId);
        myTeamRank = idx === -1 ? null : idx + 1;
      } else {
        myTeamRank = null;
      }

      // 6.6) winnerTeam
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

      // 6.7) bono team_winner (central)
      const ruleWinner = (bonusRules || []).find(
        (x: any) =>
          String(x?.ranking_type || "").toLowerCase() === "team_winner" &&
          Number(x?.position) === 1 &&
          String(x?.role || "").toLowerCase() === "central" &&
          (x?.is_active === undefined ? true : !!x?.is_active)
      );

      const bonusTeamWinner = ruleWinner ? toNum(ruleWinner.amount_eur) : 0;

      // 6.8) myEarnings central: solo bono si su equipo va #1
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
