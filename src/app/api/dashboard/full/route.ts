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

function uniq(arr: any[]) {
  return Array.from(new Set(arr));
}

function safeStr(x: any) {
  const s = String(x ?? "").trim();
  return s;
}

function monthFromDateParam(x: string | null) {
  // esperamos YYYY-MM-01 normalmente
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;
  return s;
}

/**
 * Intenta leer "team_id" de una fila que pueda tener nombres distintos.
 */
function pickTeamId(row: any) {
  const candidates = [
    row?.team_id,
    row?.teamId,
    row?.team,
    row?.teamid,
    row?.id, // a veces usan id como team id
  ];
  for (const c of candidates) {
    const s = safeStr(c);
    if (s) return s;
  }
  return null;
}

/**
 * Intenta leer "team_name" de una fila con nombres distintos.
 */
function pickTeamName(row: any) {
  const candidates = [
    row?.team_name,
    row?.name,
    row?.display_name,
    row?.title,
  ];
  for (const c of candidates) {
    const s = safeStr(c);
    if (s) return s;
  }
  return null;
}

/**
 * Score del equipo (según tu regla: %Clientes + %Repite)
 */
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

    // worker (rol)
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
    const monthParam = monthFromDateParam(urlObj.searchParams.get("month_date"));

    // meses disponibles (fuente: worker_invoices)
    const { data: invoiceRows } = await db
      .from("worker_invoices")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    const months = uniq((invoiceRows || []).map((r: any) => r.month_date).filter(Boolean)) as string[];
    const month_date = monthParam || months[0] || null;

    // Si no hay meses
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
    // 3) MIS GANANCIAS (tarotista usa factura)
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
    // 4) INCIDENCIAS DEL MES (solo unjustified penaliza)
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
    // 5) BONUS RULES (si existe tabla bonus_rules)
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
    // 6) CENTRAL: Ranking GLOBAL por equipos
    // ===============================
    let teamsRanking: TeamRow[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    if (myRole === "central") {
      /**
       * ⚠️ Para evitar el error TS (instantiation deep):
       * usamos (db as any) en consultas con select/campos dinámicos.
       */
      const adb: any = db as any;

      // helper: intenta localizar el team_id de este central en central_teams con diferentes columnas
      const tryGetTeam = async (sel: string, eqCol: string, eqVal: string) => {
        try {
          const { data } = await adb.from("central_teams").select(sel).eq(eqCol, eqVal).limit(5);
          const row = (data || [])[0] as any;
          if (!row) return null;
          const tid = pickTeamId(row);
          if (!tid) return null;
          return { team_id: tid };
        } catch (e) {
          return null;
        }
      };

      // intenta por user_id del central y por worker_id, por si tu tabla usa uno u otro
      const myTeam =
        (await tryGetTeam("team_id, team_name, name, id", "central_user_id", uid)) ||
        (await tryGetTeam("team_id, team_name, name, id", "central_worker_id", myWorkerId)) ||
        (await tryGetTeam("team_id, team_name, name, id", "user_id", uid)) ||
        (await tryGetTeam("team_id, team_name, name, id", "worker_id", myWorkerId));

      // Lista de equipos (top 10)
      // Si tu central_teams ya es una vista con métricas, esto lo cogerá.
      // Si no, igualmente devolvemos vacío sin romper.
      type RawTeam = any;
      let rawTeams: RawTeam[] = [];

      try {
        const { data: tRows } = await adb
          .from("central_teams")
          .select("*")
          .limit(50);

        if (Array.isArray(tRows)) rawTeams = tRows;
      } catch (e) {
        rawTeams = [];
      }

      // Para construir ranking por equipos, necesitamos:
      // - team_id
      // - team_name
      // - team_cliente_pct
      // - team_repite_pct
      // - total_minutes
      // - total_captadas
      //
      // Si tu tabla/vista no tiene estos campos, lo dejamos a 0.
      const normalizedTeams: TeamRow[] = (rawTeams || [])
        .map((t: any) => {
          const team_id = pickTeamId(t);
          if (!team_id) return null;

          const team_name = pickTeamName(t) || `Equipo ${team_id.slice(0, 6)}`;
          const team_cliente_pct = toNum(t.team_cliente_pct ?? t.cliente_pct ?? t.clientes_pct ?? t.clientePercent);
          const team_repite_pct = toNum(t.team_repite_pct ?? t.repite_pct ?? t.repitePercent);
          const total_minutes = toNum(t.total_minutes ?? t.minutes_total ?? t.minutes);
          const total_captadas = toNum(t.total_captadas ?? t.captadas_total ?? t.captadas);
          const total_eur_month = toNum(t.total_eur_month ?? t.total_eur ?? t.eur_total);
          const member_count = toNum(t.member_count ?? t.members_count ?? t.members ?? 0);

          const team_score = calcTeamScore(team_cliente_pct, team_repite_pct);

          return {
            team_id,
            team_name,
            total_eur_month,
            total_minutes,
            total_captadas,
            member_count,
            team_cliente_pct,
            team_repite_pct,
            team_score,
            members: [],
          } as TeamRow;
        })
        .filter(Boolean) as TeamRow[];

      // ordenar por score (desc)
      normalizedTeams.sort((a, b) => (toNum(b.team_score) - toNum(a.team_score)));

      // si solo quieres 2 equipos, cortamos a 2 (pero mantenemos top por si futuro)
      teamsRanking = normalizedTeams.slice(0, 10);

      // members: intentamos cargar miembros si existe tabla central_team_members o algo similar
      // (best-effort: si no existe, no rompe)
      try {
        // Detectamos equipos que vamos a mostrar (top 2 visualmente normalmente)
        const showTeamIds = teamsRanking.slice(0, 2).map((t) => t.team_id);

        if (showTeamIds.length) {
          // intentamos tabla "central_team_members": team_id, worker_id
          const { data: memRows } = await adb
            .from("central_team_members")
            .select("team_id, worker_id, workers:workers(id, display_name)")
            .in("team_id", showTeamIds)
            .limit(5000);

          if (Array.isArray(memRows)) {
            const map = new Map<string, TeamMember[]>();
            for (const r of memRows) {
              const tid = safeStr(r.team_id);
              const wid = safeStr(r.worker_id);
              const name = r.workers?.display_name || (wid ? wid.slice(0, 8) : "—");
              if (!tid || !wid) continue;
              const arr = map.get(tid) || [];
              arr.push({ worker_id: wid, name });
              map.set(tid, arr);
            }

            teamsRanking = teamsRanking.map((t) => ({
              ...t,
              members: map.get(t.team_id) || [],
              member_count: (map.get(t.team_id) || []).length || t.member_count || 0,
            }));
          }
        }
      } catch (e) {
        // ignore
      }

      // myTeamRank
      if (myTeam?.team_id) {
        const idx = teamsRanking.findIndex((t) => t.team_id === myTeam.team_id);
        myTeamRank = idx === -1 ? null : idx + 1;
      } else {
        myTeamRank = null;
      }

      // winnerTeam (top 1)
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

      // Bono potencial del equipo ganador (rule team_winner position 1 role central)
      const ruleWinner = (bonusRules || []).find(
        (x: any) =>
          String(x?.ranking_type || "").toLowerCase() === "team_winner" &&
          Number(x?.position) === 1 &&
          String(x?.role || "").toLowerCase() === "central" &&
          (x?.is_active === undefined ? true : !!x?.is_active)
      );

      const bonusTeamWinner = ruleWinner ? toNum(ruleWinner.amount_eur) : 0;

      // myEarnings para central: solo bono si su equipo va #1
      // (si luego quieres pro-rate por turnos, lo hacemos aparte)
      const centralBonus = myTeamRank === 1 ? bonusTeamWinner : 0;

      (myEarnings as any).amount_bonus_eur = centralBonus;
      (myEarnings as any).amount_total_eur = centralBonus;
    }

    // ✅ Response final
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
