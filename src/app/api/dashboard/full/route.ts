// src/app/api/dashboard/full/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnvAny(names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
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

function uniq<T>(arr: T[]) {
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

  team_cliente_pct: number;
  team_repite_pct: number;
  team_score: number;

  members: TeamMember[];
};

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const SUPABASE_URL = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]);
    const SERVICE_KEY = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE"]);

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

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
    const { data: invoiceMonths } = await db
      .from("worker_invoices")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    const months = uniq((invoiceMonths || []).map((r: any) => r.month_date).filter(Boolean)) as string[];
    const month_date = monthParam || months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        user: { isAdmin: myRole === "admin", worker: me },
        rankings: { minutes: [], repite_pct: [], cliente_pct: [], captadas: [], eur_total: [], eur_bonus: [] },
        myEarnings: null,
        myIncidentsMonth: { count: 0, penalty_eur: 0, grave: false },
        teamsRanking: [],
        myTeamRank: null,
        winnerTeam: null,
        bonusRules: [],
      });
    }

    // =========================
    // 1) monthly_rankings (SIN JOIN)
    // =========================
    const { data: mr, error: emr } = await db
      .from("monthly_rankings")
      .select("worker_id, minutes_total, captadas_total, cliente_pct, repite_pct")
      .eq("month_date", month_date)
      .limit(10000);

    if (emr) {
      return NextResponse.json({ ok: false, error: `monthly_rankings: ${emr.message}` }, { status: 500 });
    }

    const workerIds = uniq((mr || []).map((x: any) => String(x.worker_id)).filter(Boolean));

    // =========================
    // 2) workers (para nombre/rol)
    // =========================
    const workersMap = new Map<string, { name: string; role: string }>();
    if (workerIds.length > 0) {
      const { data: ws, error: ews } = await db
        .from("workers")
        .select("id, display_name, role")
        .in("id", workerIds)
        .limit(10000);

      if (ews) {
        return NextResponse.json({ ok: false, error: `workers: ${ews.message}` }, { status: 500 });
      }

      for (const w of ws || []) {
        workersMap.set(String((w as any).id), {
          name: (w as any).display_name || "—",
          role: (w as any).role || "",
        });
      }
    }

    const rows: RankRow[] = (mr || []).map((x: any) => {
      const wid = String(x.worker_id);
      const w = workersMap.get(wid);
      return {
        worker_id: wid,
        name: w?.name || wid.slice(0, 8),
        role: w?.role || "",
        minutes: toNum(x.minutes_total),
        captadas: toNum(x.captadas_total),
        cliente_pct: toNum(x.cliente_pct),
        repite_pct: toNum(x.repite_pct),
      };
    });

    const tarotistas = rows.filter((x) => normRole(x.role) === "tarotista");

    // =========================
    // 3) worker_invoices para euros
    // =========================
    const { data: invoices } = await db
      .from("worker_invoices")
      .select("worker_id, total_eur, bonuses_eur")
      .eq("month_date", month_date);

    const invoiceMap = new Map<string, any>();
    for (const inv of invoices || []) invoiceMap.set(String((inv as any).worker_id), inv);

    // rankings
    const rankMinutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes);
    const rankCaptadas = [...tarotistas].sort((a, b) => b.captadas - a.captadas);
    const rankCliente = [...tarotistas].sort((a, b) => b.cliente_pct - a.cliente_pct);
    const rankRepite = [...tarotistas].sort((a, b) => b.repite_pct - a.repite_pct);

    const rankEurTotal = [...tarotistas]
      .map((t) => ({ worker_id: t.worker_id, name: t.name, eur_total: toNum(invoiceMap.get(t.worker_id)?.total_eur) }))
      .sort((a, b) => b.eur_total - a.eur_total);

    const rankEurBonus = [...tarotistas]
      .map((t) => ({ worker_id: t.worker_id, name: t.name, eur_bonus: toNum(invoiceMap.get(t.worker_id)?.bonuses_eur) }))
      .sort((a, b) => b.eur_bonus - a.eur_bonus);

    // myEarnings
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

    // =========================
    // 4) bonus_rules
    // =========================
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

    // =========================
    // 5) CENTRAL: teamsRanking REAL (SIN team_monthly_results)
    // =========================
    let teamsRanking: TeamRow[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    if (myRole === "central") {
      // teams
      const { data: teamsRaw } = await db.from("teams").select("*").limit(5000);
      const teamNameMap = new Map<string, string>();
      for (const t of teamsRaw || []) {
        const id = String((t as any).id || "");
        if (!id) continue;
        const name =
          (t as any).team_name ||
          (t as any).name ||
          (t as any).display_name ||
          (t as any).title ||
          `Equipo ${id.slice(0, 6)}`;
        teamNameMap.set(id, String(name));
      }

      // team_members (sin join)
      const { data: tmRaw } = await db.from("team_members").select("team_id, worker_id").limit(20000);

      const workerToTeam = new Map<string, string>();
      const teamMembersMap = new Map<string, string[]>();

      for (const r of tmRaw || []) {
        const tid = String((r as any).team_id || "");
        const wid = String((r as any).worker_id || "");
        if (!tid || !wid) continue;

        workerToTeam.set(wid, tid);
        const arr = teamMembersMap.get(tid) || [];
        arr.push(wid);
        teamMembersMap.set(tid, arr);
      }

      // nombres miembros (consulta workers por ids de team_members)
      const memberIds = uniq((tmRaw || []).map((x: any) => String(x.worker_id)).filter(Boolean));
      const memberNameMap = new Map<string, string>();
      if (memberIds.length > 0) {
        const { data: mw } = await db.from("workers").select("id, display_name").in("id", memberIds).limit(20000);
        for (const w of mw || []) {
          memberNameMap.set(String((w as any).id), (w as any).display_name || String((w as any).id).slice(0, 8));
        }
      }

      // agregación con monthly_rankings (tarotistas)
      type Agg = {
        team_id: string;
        total_minutes: number;
        total_captadas: number;
        w_sum: number;
        cliente_sum: number;
        repite_sum: number;
        total_eur_month: number;
      };

      const aggMap = new Map<string, Agg>();

      for (const t of tarotistas) {
        const tid = workerToTeam.get(t.worker_id);
        if (!tid) continue;

        const w = t.minutes > 0 ? t.minutes : 1;

        const prev = aggMap.get(tid) || {
          team_id: tid,
          total_minutes: 0,
          total_captadas: 0,
          w_sum: 0,
          cliente_sum: 0,
          repite_sum: 0,
          total_eur_month: 0,
        };

        prev.total_minutes += t.minutes;
        prev.total_captadas += t.captadas;
        prev.w_sum += w;
        prev.cliente_sum += t.cliente_pct * w;
        prev.repite_sum += t.repite_pct * w;

        const inv = invoiceMap.get(t.worker_id);
        prev.total_eur_month += toNum(inv?.total_eur);

        aggMap.set(tid, prev);
      }

      // construir lista FINAL:
      // Si no hay monthly_rankings, aun así devolvemos equipos con member_count (score 0)
      const allTeamIds = uniq([
        ...Array.from(teamNameMap.keys()),
        ...Array.from(teamMembersMap.keys()),
        ...Array.from(aggMap.keys()),
      ]);

      teamsRanking = allTeamIds
        .map((tid) => {
          const a = aggMap.get(tid);
          const memberIds = teamMembersMap.get(tid) || [];
          const members: TeamMember[] = memberIds.map((wid) => ({
            worker_id: wid,
            name: memberNameMap.get(wid) || wid.slice(0, 8),
          }));

          const team_cliente_pct = a?.w_sum ? Number((a.cliente_sum / a.w_sum).toFixed(2)) : 0;
          const team_repite_pct = a?.w_sum ? Number((a.repite_sum / a.w_sum).toFixed(2)) : 0;
          const team_score = calcTeamScore(team_cliente_pct, team_repite_pct);

          return {
            team_id: tid,
            team_name: teamNameMap.get(tid) || `Equipo ${tid.slice(0, 6)}`,
            total_eur_month: Number((a?.total_eur_month || 0).toFixed(2)),
            total_minutes: Number((a?.total_minutes || 0).toFixed(0)),
            total_captadas: Number((a?.total_captadas || 0).toFixed(0)),
            member_count: members.length,
            team_cliente_pct,
            team_repite_pct,
            team_score,
            members,
          } as TeamRow;
        })
        .sort((x, y) => toNum(y.team_score) - toNum(x.team_score));

      // winnerTeam
      const win = teamsRanking[0] || null;
      winnerTeam = win
        ? { team_id: win.team_id, team_name: win.team_name, team_score: win.team_score }
        : null;

      // myTeamRank (central_teams opcional, si existe)
      let myTeamId = "";
      try {
        const { data: ct } = await db.from("central_teams").select("*").limit(5000);
        const found =
          (ct || []).find((x: any) => String(x.central_worker_id || x.worker_id || x.central_id || "") === myWorkerId) ||
          (ct || []).find((x: any) => String(x.central_user_id || x.user_id || "") === uid);

        if (found) myTeamId = String(found.team_id || found.team || found.id || "");
      } catch {
        myTeamId = "";
      }

      if (!myTeamId) myTeamId = workerToTeam.get(myWorkerId) || "";

      if (myTeamId) {
        const idx = teamsRanking.findIndex((t) => t.team_id === myTeamId);
        myTeamRank = idx >= 0 ? idx + 1 : null;
      } else {
        myTeamRank = null;
      }

      // bono team_winner si existe regla
      const ruleWinner = (bonusRules || []).find(
        (x: any) =>
          String(x?.ranking_type || "").toLowerCase() === "team_winner" &&
          Number(x?.position) === 1 &&
          String(x?.role || "").toLowerCase() === "central" &&
          (x?.is_active === undefined ? true : !!x?.is_active)
      );

      const bonusTeamWinner = ruleWinner ? toNum(ruleWinner.amount_eur) : 0;
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
      myIncidentsMonth: { count: 0, penalty_eur: 0, grave: false }, // lo dejamos simple aquí (no rompe nada)
      teamsRanking,
      myTeamRank,
      winnerTeam,
      bonusRules,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
