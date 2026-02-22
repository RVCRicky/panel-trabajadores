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

async function safeEqFirst(
  adb: any,
  table: string,
  selectCols: string,
  candidates: Array<{ col: string; val: any }>
) {
  for (const c of candidates) {
    try {
      const { data, error } = await adb
        .from(table)
        .select(selectCols)
        .eq(c.col, c.val)
        .limit(1);
      if (!error && Array.isArray(data) && data[0]) return data[0];
    } catch (e) {
      // si la columna no existe, supabase devuelve error -> seguimos probando
    }
  }
  return null;
}

// ✅ intenta extraer el worker_id o user_id real desde una fila de team_members
function extractMemberIds(row: any): { worker_id?: string; user_id?: string } {
  const keys = Object.keys(row || {});
  const pick = (cands: string[]) => {
    for (const k of cands) {
      if (k in (row || {})) {
        const v = safeStr((row as any)[k]);
        if (v) return v;
      }
    }
    // prueba "fuzzy" (por si el campo se llama raro)
    for (const k of keys) {
      const lk = k.toLowerCase();
      if (cands.some((c) => lk === c.toLowerCase())) {
        const v = safeStr((row as any)[k]);
        if (v) return v;
      }
    }
    return "";
  };

  // worker id candidates
  const wid = pick([
    "worker_id",
    "member_worker_id",
    "workerid",
    "worker",
    "member_id",
    "member_worker",
    "tarotist_worker_id",
  ]);

  // user id candidates (si en team_members guardas user_id en lugar de worker_id)
  const uid = pick([
    "user_id",
    "member_user_id",
    "userid",
    "user",
    "member_user",
    "auth_user_id",
  ]);

  const out: any = {};
  if (wid) out.worker_id = wid;
  if (uid) out.user_id = uid;
  return out;
}

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token)
      return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // auth user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user)
      return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    const uid = u.user.id;

    // worker
    const { data: me } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (!me)
      return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active)
      return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

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

    const months = uniq(
      (invoiceRows || []).map((r: any) => r.month_date).filter(Boolean)
    ) as string[];

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
        myTeam: null,
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
    for (const inv of invoices || [])
      invoiceMap.set(String((inv as any).worker_id), inv);

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
        const penalty = incs.reduce(
          (sum, x: any) => sum + toNum(x?.penalty_eur),
          0
        );
        const hasAbsence = incs.some(
          (x: any) => String(x?.kind || "").toLowerCase() === "absence"
        );
        const grave = count >= 5 || hasAbsence;

        myIncidentsMonth = {
          count,
          penalty_eur: Number(penalty.toFixed(2)),
          grave,
        };
      }
    } catch (e) {}

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
    } catch (e) {
      bonusRules = [];
    }

    // ===============================
    // 6) CENTRAL: EQUIPOS (teams + team_monthly_results + team_members)
    // ===============================
    let teamsRanking: TeamRow[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    // ✅ MI EQUIPO (para todos los roles)
    let myTeam: { team_id: string; team_name: string } | null = null;

    // ⚠️ Evita el bug TS (instantiation deep)
    const adb: any = db as any;

    // --- (A) construir mapa de nombres de equipos (lo usamos tanto para ranking como para myTeam)
    let teamsRows: any[] = [];
    try {
      const { data, error } = await adb.from("teams").select("*").limit(5000);
      if (!error && Array.isArray(data)) teamsRows = data;
    } catch (e) {
      teamsRows = [];
    }

    const teamNameMap = new Map<string, string>();
    for (const t of teamsRows || []) {
      const id = safeStr(t?.id || t?.team_id || t?.uuid);
      if (!id) continue;
      const name =
        safeStr(t?.team_name || t?.name || t?.display_name || t?.title) ||
        `Equipo ${id.slice(0, 6)}`;
      teamNameMap.set(id, name);
    }

    // --- (B) detectar mi equipo por team_members (soporta worker_id o user_id)
    try {
      const { data: memAll, error } = await adb.from("team_members").select("*").limit(20000);
      if (!error && Array.isArray(memAll)) {
        let foundTeamId: string | null = null;

        for (const r of memAll) {
          const tid = safeStr(r?.team_id || r?.team || r?.id_team);
          if (!tid) continue;

          const ids = extractMemberIds(r);
          if (ids.worker_id && String(ids.worker_id) === String(myWorkerId)) {
            foundTeamId = tid;
            break;
          }
          if (ids.user_id && String(ids.user_id) === String(uid)) {
            foundTeamId = tid;
            break;
          }
        }

        if (foundTeamId) {
          myTeam = {
            team_id: foundTeamId,
            team_name: teamNameMap.get(foundTeamId) || `Equipo ${foundTeamId.slice(0, 6)}`,
          };
        }
      }
    } catch (e) {
      myTeam = null;
    }

    // --- (C) ranking de equipos SOLO para central (como ya lo tenías)
    if (myRole === "central") {
      // a) resultados mensuales por equipo
      let tmrRows: any[] = [];
      try {
        const { data, error } = await adb
          .from("team_monthly_results")
          .select("*")
          .eq("month_date", month_date)
          .limit(2000);

        if (!error && Array.isArray(data)) tmrRows = data;
      } catch (e) {
        tmrRows = [];
      }

      // c) normalizar team_monthly_results
      const normalized: TeamRow[] = (tmrRows || [])
        .map((r: any) => {
          const team_id = safeStr(r?.team_id || r?.team || r?.id);
          if (!team_id) return null;

          const team_name =
            teamNameMap.get(team_id) || `Equipo ${team_id.slice(0, 6)}`;

          const total_minutes = toNum(r?.total_minutes ?? r?.minutes_total ?? r?.minutes);
          const total_captadas = toNum(r?.total_captadas ?? r?.captadas_total ?? r?.captadas);
          const total_eur_month = toNum(r?.total_eur_month ?? r?.eur_total ?? r?.total_eur);

          const team_cliente_pct = toNum(r?.team_cliente_pct ?? r?.cliente_pct ?? r?.clientes_pct);
          const team_repite_pct = toNum(r?.team_repite_pct ?? r?.repite_pct ?? r?.repite_percent);

          const team_score = calcTeamScore(team_cliente_pct, team_repite_pct);

          return {
            team_id,
            team_name,
            total_eur_month,
            total_minutes,
            total_captadas,
            member_count: 0,
            team_cliente_pct,
            team_repite_pct,
            team_score,
            members: [],
          } as TeamRow;
        })
        .filter(Boolean) as TeamRow[];

      normalized.sort((a, b) => toNum(b.team_score) - toNum(a.team_score));
      teamsRanking = normalized.slice(0, 10);

      // d) members para top 2 (team_members + workers)
      try {
        const showIds = teamsRanking.slice(0, 2).map((t) => t.team_id);
        if (showIds.length) {
          const { data: memRows, error } = await adb
            .from("team_members")
            .select("team_id, worker_id, workers:workers(id, display_name)")
            .in("team_id", showIds)
            .limit(5000);

          if (!error && Array.isArray(memRows)) {
            const map = new Map<string, TeamMember[]>();
            for (const r of memRows) {
              const tid = safeStr(r?.team_id);
              const wid = safeStr(r?.worker_id);
              if (!tid || !wid) continue;
              const name = r?.workers?.display_name || wid.slice(0, 8);
              const arr = map.get(tid) || [];
              arr.push({ worker_id: wid, name });
              map.set(tid, arr);
            }

            teamsRanking = teamsRanking.map((t) => {
              const ms = map.get(t.team_id) || [];
              return { ...t, members: ms, member_count: ms.length || t.member_count || 0 };
            });
          }
        }
      } catch (e) {}

      // e) mi equipo (central): si ya tenemos myTeam, usamos su id para rank
      if (myTeam?.team_id) {
        const idx = teamsRanking.findIndex((t) => t.team_id === myTeam!.team_id);
        myTeamRank = idx === -1 ? null : idx + 1;
      } else {
        // fallback: intentar sacar team desde teams (central_user_id/central_worker_id etc)
        const myTeamRow =
          (await safeEqFirst(
            adb,
            "teams",
            "id, team_id, name, team_name, central_user_id, central_worker_id, user_id, worker_id",
            [
              { col: "central_user_id", val: uid },
              { col: "central_worker_id", val: myWorkerId },
              { col: "user_id", val: uid },
              { col: "worker_id", val: myWorkerId },
            ]
          )) || null;

        const myTeamId = safeStr(myTeamRow?.id || myTeamRow?.team_id);
        if (myTeamId) {
          const idx = teamsRanking.findIndex((t) => t.team_id === myTeamId);
          myTeamRank = idx === -1 ? null : idx + 1;
          if (!myTeam) {
            myTeam = {
              team_id: myTeamId,
              team_name: teamNameMap.get(myTeamId) || `Equipo ${myTeamId.slice(0, 6)}`,
            };
          }
        } else {
          myTeamRank = null;
        }
      }

      // f) winnerTeam (top 1)
      const win = teamsRanking[0] || null;
      winnerTeam = win
        ? {
            team_id: win.team_id,
            team_name: win.team_name,
            central_user_id: null,
            central_name: null,
            total_minutes: win.total_minutes,
            total_captadas: win.total_captadas,
            total_eur_month: win.total_eur_month,
            team_score: win.team_score,
          }
        : null;

      // g) bono potencial ganador
      const ruleWinner = (bonusRules || []).find(
        (x: any) =>
          String(x?.ranking_type || "").toLowerCase() === "team_winner" &&
          Number(x?.position) === 1 &&
          String(x?.role || "").toLowerCase() === "central" &&
          (x?.is_active === undefined ? true : !!x?.is_active)
      );

      const bonusTeamWinner = ruleWinner ? toNum(ruleWinner.amount_eur) : 0;

      // h) myEarnings central: por ahora solo bono si su equipo va #1
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
      myTeam,
      winnerTeam,
      bonusRules,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
