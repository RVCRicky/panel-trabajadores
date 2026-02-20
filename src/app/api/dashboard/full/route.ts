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

type RankRowMinutes = {
  worker_id: string;
  name: string;
  minutes: number;
  captadas: number;
  cliente_pct: number;
  repite_pct: number;
};

type EarningsRow = {
  worker_id: string;
  month_date: string;
  minutes_total: number | null;
  captadas_total: number | null;
  amount_base_eur: number | null;
  amount_bonus_eur: number | null;
  amount_total_eur: number | null;
};

export async function GET(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // 1) validar user
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });
    const uid = u.user.id;

    // 2) worker del usuario
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

    // 3) mes seleccionado (opcional) + lista de meses disponibles
    const urlObj = new URL(req.url);
    const monthParam = urlObj.searchParams.get("month_date"); // "YYYY-MM-01"
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

    // 4) rankings del mes desde monthly_rankings + join a workers
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
          role
        )
      `
      )
      .eq("month_date", month_date)
      .limit(5000);

    if (emr) return NextResponse.json({ ok: false, error: emr.message }, { status: 500 });

    // 5) normalizar filas
    const rows = (mr || [])
      .map((x: any) => {
        const w = x.workers || null;
        return {
          worker_id: x.worker_id,
          name: w?.display_name || "—",
          role: w?.role || "",
          minutes: toNum(x.minutes_total),
          captadas: toNum(x.captadas_total),
          cliente_pct: toNum(x.cliente_pct),
          repite_pct: toNum(x.repite_pct),
        };
      })
      .filter((x: any) => x.worker_id);

    // solo tarotistas para ranking principal
    const tarotistas = rows.filter((x: any) => normRole(x.role) === "tarotista");

    const rankMinutes: RankRowMinutes[] = [...tarotistas].sort((a, b) => b.minutes - a.minutes);

    const rankCaptadas = [...tarotistas]
      .sort((a, b) => b.captadas - a.captadas)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, captadas: x.captadas }));

    const rankCliente = [...tarotistas]
      .sort((a, b) => b.cliente_pct - a.cliente_pct)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, cliente_pct: x.cliente_pct }));

    const rankRepite = [...tarotistas]
      .sort((a, b) => b.repite_pct - a.repite_pct)
      .map((x) => ({ worker_id: x.worker_id, name: x.name, repite_pct: x.repite_pct }));

    // ------------------------------------------------------------
    // ✅ myEarnings (sin romper si no existe la tabla)
    // ------------------------------------------------------------
    let earningsByWorker = new Map<string, EarningsRow>();
    let myEarnings: any = null;

    try {
      const { data: earnRows, error: eearn } = await db
        .from("monthly_earnings")
        .select(
          "worker_id, month_date, minutes_total, captadas_total, amount_base_eur, amount_bonus_eur, amount_total_eur"
        )
        .eq("month_date", month_date)
        .limit(5000);

      if (!eearn && Array.isArray(earnRows)) {
        for (const r of earnRows as any[]) {
          earningsByWorker.set(String(r.worker_id), r as EarningsRow);
        }
      }
    } catch {
      // si la tabla no existe o no hay permisos, no rompemos
    }

    const myEarn = earningsByWorker.get(myWorkerId);
    if (myEarn) {
      myEarnings = {
        minutes_total: toNum(myEarn.minutes_total),
        captadas: toNum(myEarn.captadas_total),
        amount_base_eur: toNum(myEarn.amount_base_eur),
        amount_bonus_eur: toNum(myEarn.amount_bonus_eur),
        amount_total_eur: toNum(myEarn.amount_total_eur),
      };
    } else {
      // fallback: al menos minutos/captadas, € 0 para que no salga null
      const myRankRow = rows.find((r) => String(r.worker_id) === myWorkerId) || null;
      myEarnings = {
        minutes_total: toNum(myRankRow?.minutes ?? 0),
        captadas: toNum(myRankRow?.captadas ?? 0),
        amount_base_eur: 0,
        amount_bonus_eur: 0,
        amount_total_eur: 0,
      };
    }

    // ------------------------------------------------------------
    // ✅ Ranking por equipos (sin romper si no existen tablas)
    // ------------------------------------------------------------
    let teamsRanking: any[] = [];
    let myTeamRank: number | null = null;
    let winnerTeam: any = null;

    try {
      const { data: teams, error: et } = await db.from("teams").select("id, name").limit(50);
      const { data: members, error: etm } = await db.from("team_members").select("team_id, worker_id").limit(5000);

      if (!et && !etm && Array.isArray(teams) && Array.isArray(members) && teams.length > 0) {
        const membersByTeam = new Map<string, string[]>();
        for (const m of members as any[]) {
          const tid = String(m.team_id || "");
          const wid = String(m.worker_id || "");
          if (!tid || !wid) continue;
          if (!membersByTeam.has(tid)) membersByTeam.set(tid, []);
          membersByTeam.get(tid)!.push(wid);
        }

        const agg = (teams as any[]).map((t) => {
          const tid = String(t.id);
          const wids = membersByTeam.get(tid) || [];

          let total_eur = 0;
          let total_minutes = 0;
          let total_captadas = 0;

          for (const wid of wids) {
            const er = earningsByWorker.get(wid);
            if (er) {
              total_eur += toNum(er.amount_total_eur);
              total_minutes += toNum(er.minutes_total);
              total_captadas += toNum(er.captadas_total);
            } else {
              const rr = rows.find((r) => String(r.worker_id) === String(wid));
              if (rr) {
                total_minutes += toNum(rr.minutes);
                total_captadas += toNum(rr.captadas);
              }
            }
          }

          return {
            team_id: tid,
            team_name: t.name || "Equipo",
            total_eur_month: total_eur,
            total_minutes,
            total_captadas,
            member_count: wids.length,
          };
        });

        teamsRanking = agg.sort((a, b) => b.total_eur_month - a.total_eur_month);

        const myTeamId = (members as any[]).find((m) => String(m.worker_id) === myWorkerId)?.team_id || null;
        if (myTeamId) {
          const idx = teamsRanking.findIndex((t) => String(t.team_id) === String(myTeamId));
          myTeamRank = idx === -1 ? null : idx + 1;
        }

        if (teamsRanking.length > 0) {
          const w = teamsRanking[0];
          winnerTeam = {
            team_id: w.team_id,
            team_name: w.team_name,
            central_user_id: null,
            central_name: null,
            total_minutes: w.total_minutes,
            total_captadas: w.total_captadas,
            total_eur_month: w.total_eur_month,
          };
        }
      }
    } catch {
      // si no existen tablas, no rompemos
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
      },
      myEarnings,
      winnerTeam,
      teamsRanking,
      myTeamRank,
      bonusRules: [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
