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

type TeamMember = {
  worker_id: string;
  name: string;
  role: string;
};

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

function extractMemberIds(row: any): { worker_id?: string; user_id?: string } {
  const keys = Object.keys(row || {});
  const pick = (cands: string[]) => {
    for (const k of cands) {
      if (k in (row || {})) {
        const v = safeStr((row as any)[k]);
        if (v) return v;
      }
    }
    for (const k of keys) {
      const lk = k.toLowerCase();
      if (cands.some((c) => lk === c.toLowerCase())) {
        const v = safeStr((row as any)[k]);
        if (v) return v;
      }
    }
    return "";
  };

  // ✅ AQUÍ ESTÁ LA CLAVE:
  // tu tabla team_members usa "tarotista_worker_id"
  const wid = pick([
    "worker_id",
    "tarotista_worker_id",   // ✅ TU COLUMNA REAL
    "tarotist_worker_id",
    "member_worker_id",
    "workerid",
    "worker",
    "member_id",
  ]);

  const uid = pick(["user_id", "member_user_id", "userid", "user", "auth_user_id"]);

  const out: any = {};
  if (wid) out.worker_id = wid;
  if (uid) out.user_id = uid;
  return out;
}

function fold(s: string) {
  // quita tildes/acentos: María -> Maria
  return safeStr(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function includesLoose(hay: string, needle: string) {
  return fold(hay).includes(fold(needle));
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

    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");

    // meses disponibles
    const { data: invoiceRows } = await db
      .from("worker_invoices")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    const months = uniq((invoiceRows || []).map((r: any) => r.month_date).filter(Boolean)) as string[];
    const month_date = monthParam || months[0] || null;

    // ✅ retrocompat: monthDate (camelCase)
    const monthDate = month_date;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        monthDate: null,
        months: [],
        user: { isAdmin: myRole === "admin", worker: me },
        rankings: { minutes: [], repite_pct: [], cliente_pct: [], captadas: [], eur_total: [], eur_bonus: [] },
        myEarnings: null,
        myIncidentsMonth: { count: 0, penalty_eur: 0, grave: false },
        teamsRanking: [],
        myTeamRank: null,
        myTeam: null,
        winnerTeam: null,
        bonusRules: [],
        teamYami: null,
        teamMaria: null,
      });
    }

    // ===============================
    // 1) RANKINGS
    // ===============================
    const { data: mr, error: emr } = await db
      .from("monthly_rankings")
      .select("worker_id, minutes_total, captadas_total, cliente_pct, repite_pct")
      .eq("month_date", month_date)
      .limit(10000);

    if (emr) return NextResponse.json({ ok: false, error: `monthly_rankings: ${emr.message}` }, { status: 500 });

    const workerIds = uniq((mr || []).map((x: any) => String(x.worker_id)).filter(Boolean)) as string[];

    const workersMap = new Map<string, { display_name: string; role: string }>();
    if (workerIds.length) {
      const { data: ws } = await db.from("workers").select("id, display_name, role").in("id", workerIds).limit(10000);
      for (const w of ws || []) {
        workersMap.set(String((w as any).id), {
          display_name: (w as any).display_name || "—",
          role: (w as any).role || "",
        });
      }
    }

    const rows = (mr || [])
      .map((x: any) => {
        const wid = String(x.worker_id || "");
        const w = workersMap.get(wid);
        const minutes_total = toNum(x.minutes_total);
        const captadas_total = toNum(x.captadas_total);

        return {
          worker_id: wid,
          name: w?.display_name || wid.slice(0, 8),
          role: w?.role || "",
          minutes: minutes_total,
          captadas: captadas_total,
          cliente_pct: toNum(x.cliente_pct),
          repite_pct: toNum(x.repite_pct),

          minutes_total,
          captadas_total,
        };
      })
      .filter((x: any) => x.worker_id);

    const tarotistas = rows.filter((x: any) => normRole(x.role) === "tarotista");

    const rankMinutes = [...tarotistas].sort((a: any, b: any) => b.minutes - a.minutes);
    const rankCaptadas = [...tarotistas].sort((a: any, b: any) => b.captadas - a.captadas);
    const rankCliente = [...tarotistas].sort((a: any, b: any) => b.cliente_pct - a.cliente_pct);
    const rankRepite = [...tarotistas].sort((a: any, b: any) => b.repite_pct - a.repite_pct);

    // ===============================
    // 2) FACTURAS (€)
    // ===============================
    const { data: invoices } = await db
      .from("worker_invoices")
      .select("worker_id, total_eur, bonuses_eur")
      .eq("month_date", month_date);

    const invoiceMap = new Map<string, any>();
    for (const inv of invoices || []) invoiceMap.set(String((inv as any).worker_id), inv);

    const rankEurTotal = [...tarotistas]
      .map((t: any) => ({ worker_id: t.worker_id, name: t.name, eur_total: toNum(invoiceMap.get(t.worker_id)?.total_eur) }))
      .sort((a: any, b: any) => b.eur_total - a.eur_total);

    const rankEurBonus = [...tarotistas]
      .map((t: any) => ({ worker_id: t.worker_id, name: t.name, eur_bonus: toNum(invoiceMap.get(t.worker_id)?.bonuses_eur) }))
      .sort((a: any, b: any) => b.eur_bonus - a.eur_bonus);

    // ===============================
    // 3) MIS GANANCIAS
    // ===============================
    const myInvoice = invoiceMap.get(myWorkerId);
    const myRankRow = rows.find((r: any) => r.worker_id === myWorkerId);

    const myEarnings =
      myRole === "tarotista"
        ? {
            minutes_total: toNum(myRankRow?.minutes_total),
            captadas: toNum(myRankRow?.captadas_total),
            amount_base_eur: 0,
            amount_bonus_eur: toNum(myInvoice?.bonuses_eur),
            amount_total_eur: toNum(myInvoice?.total_eur),
          }
        : { minutes_total: 0, captadas: 0, amount_base_eur: 0, amount_bonus_eur: 0, amount_total_eur: 0 };

    // ===============================
    // 4) INCIDENCIAS
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
        myIncidentsMonth = { count, penalty_eur: Number(penalty.toFixed(2)), grave: count >= 5 || hasAbsence };
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
    // 6) EQUIPOS (fallback REAL)
    // ===============================
    let teamsRanking: TeamRow[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;
    let myTeam: { team_id: string; team_name: string } | null = null;
    let teamYami: TeamRow | null = null;
    let teamMaria: TeamRow | null = null;

    // a) mapa teams id -> name
    let teamsRows: any[] = [];
    try {
      const { data, error } = await (db as any).from("teams").select("*").limit(5000);
      if (!error && Array.isArray(data)) teamsRows = data;
    } catch {
      teamsRows = [];
    }

    const teamNameMap = new Map<string, string>();
    for (const t of teamsRows || []) {
      const id = safeStr(t?.id || t?.team_id || t?.uuid);
      if (!id) continue;
      const name = safeStr(t?.team_name || t?.name || t?.display_name || t?.title) || `Equipo ${id.slice(0, 6)}`;
      teamNameMap.set(id, name);
    }

    // b) miembros por equipo desde team_members
    const teamMembersMap = new Map<string, TeamMember[]>();
    try {
      const { data: memAll, error } = await (db as any).from("team_members").select("*").limit(20000);
      if (!error && Array.isArray(memAll) && memAll.length > 0) {
        for (const r of memAll) {
          const tid = safeStr(r?.team_id || r?.team || r?.id_team);
          if (!tid) continue;

          const ids = extractMemberIds(r);
          const wid = ids.worker_id ? String(ids.worker_id) : "";
          if (!wid) continue;

          const w = workersMap.get(wid);
          const name = w?.display_name || wid.slice(0, 8);
          const role = w?.role || "";

          const arr = teamMembersMap.get(tid) || [];
          arr.push({ worker_id: wid, name, role });
          teamMembersMap.set(tid, arr);
        }
      }
    } catch {}

    // c) mi team por membresía
    for (const [tid, members] of teamMembersMap.entries()) {
      if (members.some((m) => String(m.worker_id) === String(myWorkerId))) {
        myTeam = { team_id: tid, team_name: teamNameMap.get(tid) || `Equipo ${tid.slice(0, 6)}` };
        break;
      }
    }

    // d) intentamos tabla team_monthly_results (si existe y tiene datos)
    let tmrRows: any[] = [];
    try {
      const { data, error } = await (db as any).from("team_monthly_results").select("*").eq("month_date", month_date).limit(2000);
      if (!error && Array.isArray(data)) tmrRows = data;
    } catch {
      tmrRows = [];
    }

    // e) fallback real desde monthly_rankings + invoices
    const buildTeamsFromRankings = (): TeamRow[] => {
      const mrMap = new Map<string, any>();
      for (const r of rows) mrMap.set(String(r.worker_id), r);

      const out: TeamRow[] = [];

      for (const [team_id, members] of teamMembersMap.entries()) {
        const team_name = teamNameMap.get(team_id) || `Equipo ${team_id.slice(0, 6)}`;

        let total_minutes = 0;
        let total_captadas = 0;
        let total_eur_month = 0;

        let wCli = 0;
        let wRep = 0;
        let wSum = 0;

        let avgCliSum = 0;
        let avgRepSum = 0;
        let avgN = 0;

        for (const m of members) {
          const r = mrMap.get(String(m.worker_id));
          const minutes = toNum(r?.minutes_total ?? r?.minutes);
          const captadas = toNum(r?.captadas_total ?? r?.captadas);

          total_minutes += minutes;
          total_captadas += captadas;
          total_eur_month += toNum(invoiceMap.get(String(m.worker_id))?.total_eur);

          const cli = toNum(r?.cliente_pct);
          const rep = toNum(r?.repite_pct);

          if (minutes > 0) {
            wCli += cli * minutes;
            wRep += rep * minutes;
            wSum += minutes;
          }

          avgCliSum += cli;
          avgRepSum += rep;
          avgN += 1;
        }

        const team_cliente_pct = wSum > 0 ? Number((wCli / wSum).toFixed(2)) : avgN > 0 ? Number((avgCliSum / avgN).toFixed(2)) : 0;
        const team_repite_pct = wSum > 0 ? Number((wRep / wSum).toFixed(2)) : avgN > 0 ? Number((avgRepSum / avgN).toFixed(2)) : 0;
        const team_score = calcTeamScore(team_cliente_pct, team_repite_pct);

        out.push({
          team_id,
          team_name,
          total_eur_month: Number(total_eur_month.toFixed(2)),
          total_minutes: Number(total_minutes.toFixed(2)),
          total_captadas: Number(total_captadas.toFixed(2)),
          member_count: members.length,
          team_cliente_pct,
          team_repite_pct,
          team_score,
          members,
        });
      }

      out.sort((a, b) => toNum(b.team_score) - toNum(a.team_score));
      return out;
    };

    let normalized: TeamRow[] = [];

    if (Array.isArray(tmrRows) && tmrRows.length > 0) {
      normalized = (tmrRows || [])
        .map((r: any) => {
          const team_id = safeStr(r?.team_id || r?.team || r?.id);
          if (!team_id) return null;

          const team_name = teamNameMap.get(team_id) || `Equipo ${team_id.slice(0, 6)}`;

          const total_minutes = toNum(r?.total_minutes ?? r?.minutes_total ?? r?.minutes);
          const total_captadas = toNum(r?.total_captadas ?? r?.captadas_total ?? r?.captadas);
          const total_eur_month = toNum(r?.total_eur_month ?? r?.eur_total ?? r?.total_eur);

          const team_cliente_pct = toNum(r?.team_cliente_pct ?? r?.cliente_pct ?? r?.clientes_pct);
          const team_repite_pct = toNum(r?.team_repite_pct ?? r?.repite_pct ?? r?.repite_percent);

          const team_score = calcTeamScore(team_cliente_pct, team_repite_pct);
          const members = teamMembersMap.get(team_id) || [];

          return {
            team_id,
            team_name,
            total_eur_month,
            total_minutes,
            total_captadas,
            member_count: members.length,
            team_cliente_pct,
            team_repite_pct,
            team_score,
            members,
          } as TeamRow;
        })
        .filter(Boolean) as TeamRow[];
      normalized.sort((a, b) => toNum(b.team_score) - toNum(a.team_score));
    } else {
      normalized = buildTeamsFromRankings();
    }

    if (myRole === "central") {
      teamsRanking = normalized.slice(0, 10);

      if (myTeam?.team_id) {
        const idx = teamsRanking.findIndex((t) => t.team_id === myTeam!.team_id);
        myTeamRank = idx === -1 ? null : idx + 1;
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
    }

    // teamYami / teamMaria
    const findTeamByName = (needle: string) => {
      for (const [tid, name] of teamNameMap.entries()) {
        if (includesLoose(name, needle)) return tid;
      }
      return null;
    };

    const yamiId = findTeamByName("yami");
    const mariaId = findTeamByName("maria");

    const normalizedMap = new Map<string, TeamRow>();
    for (const t of normalized) normalizedMap.set(t.team_id, t);

    if (yamiId && normalizedMap.get(yamiId)) teamYami = normalizedMap.get(yamiId)!;
    if (mariaId && normalizedMap.get(mariaId)) teamMaria = normalizedMap.get(mariaId)!;

    return NextResponse.json({
      ok: true,
      month_date,
      monthDate,

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
      myTeam,
      winnerTeam,
      bonusRules,

      teamYami,
      teamMaria,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
