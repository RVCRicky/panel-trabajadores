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

type EarningsRow = {
  worker_id: string;
  month_date: string;
  minutes_total: number | null;
  captadas_total: number | null;
  amount_base_eur: number | null;
  amount_bonus_eur: number | null;
  amount_total_eur: number | null;
};

type BonusRuleRow = {
  ranking_type: string;
  position: number;
  role: string;
  amount_eur: number;
  is_active?: boolean;
};

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // 1) user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    const uid = u.user.id;

    // 2) worker
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const myWorkerId = String((me as any).id || "");
    const myRole = normRole((me as any).role);

    // 3) month
    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date");
    let month_date: string | null = monthParam || null;

    const { data: monthsRows, error: emonths } = await db
      .from("monthly_rankings")
      .select("month_date")
      .order("month_date", { ascending: false })
      .limit(36);

    if (emonths) return NextResponse.json({ ok: false, error: emonths.message }, { status: 500 });

    const months = Array.from(new Set((monthsRows || []).map((r: any) => r.month_date).filter(Boolean))) as string[];
    if (!month_date) month_date = months[0] || null;

    if (!month_date) {
      return NextResponse.json({
        ok: true,
        month_date: null,
        months: [],
        user: { isAdmin: myRole === "admin", worker: me },
        rankings: { minutes: [], repite_pct: [], cliente_pct: [], captadas: [] },
        myEarnings: null,
        winnerTeam: null,
        teamsRanking: [],
        myTeamRank: null,
        bonusRules: [],
      });
    }

    // 4) monthly_rankings + workers
    const { data: mr, error: emr } = await db
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
          role,
          user_id
        )
      `
      )
      .eq("month_date", month_date)
      .limit(5000);

    if (emr) return NextResponse.json({ ok: false, error: emr.message }, { status: 500 });

    const rows = (mr || [])
      .map((x: any) => {
        const w = x.workers || null;
        return {
          worker_id: String(x.worker_id),
          name: w?.display_name || "—",
          role: w?.role || "",
          minutes: toNum(x.minutes_total),
          captadas: toNum(x.captadas_total),
          cliente_pct: toNum(x.cliente_pct),
          repite_pct: toNum(x.repite_pct),
        };
      })
      .filter((x: any) => x.worker_id);

    const tarotistas = rows.filter((x: any) => normRole(x.role) === "tarotista");

    const rankMinutes = [...tarotistas].sort((a, b) => b.minutes - a.minutes);
    const rankCaptadas = [...tarotistas]
      .sort((a, b) => b.captadas - a.captadas)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, captadas: x.captadas }));
    const rankCliente = [...tarotistas]
      .sort((a, b) => b.cliente_pct - a.cliente_pct)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, cliente_pct: x.cliente_pct }));
    const rankRepite = [...tarotistas]
      .sort((a, b) => b.repite_pct - a.repite_pct)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, repite_pct: x.repite_pct }));

    // 5) monthly_earnings (si existe)
    let earningsByWorker = new Map<string, EarningsRow>();
    try {
      const { data: earnRows, error: eearn } = await db
        .from("monthly_earnings")
        .select("worker_id, month_date, minutes_total, captadas_total, amount_base_eur, amount_bonus_eur, amount_total_eur")
        .eq("month_date", month_date)
        .limit(5000);

      if (!eearn && Array.isArray(earnRows)) {
        for (const r of earnRows as any[]) earningsByWorker.set(String(r.worker_id), r as EarningsRow);
      }
    } catch {}

    // 6) bonus_rules (si existe)
    let bonusRules: BonusRuleRow[] = [];
    try {
      const { data: br, error: ebr } = await db
        .from("bonus_rules")
        .select("ranking_type, position, role, amount_eur, is_active")
        .limit(2000);
      if (!ebr && Array.isArray(br)) bonusRules = br as any;
    } catch {}

    // myEarnings base
    const myEarn = earningsByWorker.get(myWorkerId);
    const myRankRow = rows.find((r) => String(r.worker_id) === myWorkerId) || null;

    let myEarnings = myEarn
      ? {
          minutes_total: toNum(myEarn.minutes_total),
          captadas: toNum(myEarn.captadas_total),
          amount_base_eur: toNum(myEarn.amount_base_eur),
          amount_bonus_eur: toNum(myEarn.amount_bonus_eur),
          amount_total_eur: toNum(myEarn.amount_total_eur),
        }
      : {
          minutes_total: toNum(myRankRow?.minutes ?? 0),
          captadas: toNum(myRankRow?.captadas ?? 0),
          amount_base_eur: 0,
          amount_bonus_eur: 0,
          amount_total_eur: 0,
        };

    // 7) Teams ranking + miembros + score global
    let teamsRanking: any[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    try {
      const { data: teams, error: et } = await db
        .from("teams")
        .select("id, name, central_user_id")
        .limit(50);

      const { data: members, error: etm } = await db
        .from("team_members")
        .select("team_id, tarotista_worker_id")
        .limit(5000);

      if (!et && !etm && Array.isArray(teams) && Array.isArray(members) && teams.length > 0) {
        const tarotistasByTeam = new Map<string, string[]>();
        for (const m of members as any[]) {
          const tid = String(m.team_id || "");
          const wid = String(m.tarotista_worker_id || "");
          if (!tid || !wid) continue;
          if (!tarotistasByTeam.has(tid)) tarotistasByTeam.set(tid, []);
          tarotistasByTeam.get(tid)!.push(wid);
        }

        const W_CLIENTE = 0.5;
        const W_REPITE = 0.5;

        const agg = (teams as any[]).map((t) => {
          const tid = String(t.id);
          const wids = tarotistasByTeam.get(tid) || [];

          let total_eur = 0;
          let total_minutes = 0;
          let total_captadas = 0;

          let sum_cliente = 0;
          let sum_repite = 0;
          let n = 0;

          const membersNames = wids
            .map((wid) => {
              const rr = rows.find((r) => String(r.worker_id) === String(wid));
              if (rr) {
                sum_cliente += toNum(rr.cliente_pct);
                sum_repite += toNum(rr.repite_pct);
                n += 1;
                total_minutes += toNum(rr.minutes);
                total_captadas += toNum(rr.captadas);
              }
              return { worker_id: wid, name: rr?.name || "—" };
            })
            .filter(Boolean);

          // €: suma real si hay monthly_earnings
          for (const wid of wids) {
            const er = earningsByWorker.get(wid);
            if (er) total_eur += toNum(er.amount_total_eur);
          }

          const team_cliente_pct = n ? Number((sum_cliente / n).toFixed(1)) : 0;
          const team_repite_pct = n ? Number((sum_repite / n).toFixed(1)) : 0;
          const team_score = Number((team_cliente_pct * W_CLIENTE + team_repite_pct * W_REPITE).toFixed(2));

          return {
            team_id: tid,
            team_name: t.name || "Equipo",
            central_user_id: t.central_user_id || null,
            total_eur_month: total_eur,
            total_minutes,
            total_captadas,
            team_cliente_pct,
            team_repite_pct,
            team_score,
            members: membersNames,
            member_count: wids.length,
          };
        });

        teamsRanking = agg.sort((a, b) => {
          if (b.team_score !== a.team_score) return b.team_score - a.team_score;
          return b.total_minutes - a.total_minutes;
        });

        const myTeamId = (teams as any[]).find((t) => String(t.central_user_id) === String(uid))?.id || null;
        if (myTeamId) {
          const idx = teamsRanking.findIndex((t) => String(t.team_id) === String(myTeamId));
          myTeamRank = idx === -1 ? null : idx + 1;
        }

        if (teamsRanking.length > 0) {
          const w = teamsRanking[0];
          winnerTeam = {
            team_id: w.team_id,
            team_name: w.team_name,
            central_user_id: w.central_user_id,
            central_name: null,
            total_minutes: w.total_minutes,
            total_captadas: w.total_captadas,
            total_eur_month: w.total_eur_month,
            team_score: w.team_score,
          };
        }

        // ✅ BONUS: team_winner (solo para #1), central
        if (myRole === "central" && myTeamRank === 1) {
          const rule = bonusRules.find(
            (r) =>
              String(r.ranking_type || "").toLowerCase() === "team_winner" &&
              Number(r.position) === 1 &&
              String(r.role || "").toLowerCase() === "central" &&
              (r.is_active === undefined ? true : !!r.is_active)
          );

          const bonus = rule ? toNum(rule.amount_eur) : 0;

          if (bonus > 0) {
            const base = toNum(myEarnings.amount_base_eur);
            const prevBonus = toNum(myEarnings.amount_bonus_eur);
            const newBonus = prevBonus + bonus;

            myEarnings = {
              ...myEarnings,
              amount_bonus_eur: newBonus,
              amount_total_eur: base + newBonus,
            };
          }
        }
      }
    } catch {}

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
      },
      myEarnings,
      winnerTeam,
      teamsRanking,
      myTeamRank,
      bonusRules,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
