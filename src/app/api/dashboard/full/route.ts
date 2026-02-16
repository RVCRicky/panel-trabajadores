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

function monthFromDate(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

export async function GET(req: Request) {
  try {
    const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
    const anonKey = getEnvAny(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    const serviceKey = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);

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

    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", uid).maybeSingle();
    const isAdmin = !!adminRow;

    const { data: meWorker, error: wErr } = await db
      .from("workers")
      .select("id, user_id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });

    const month_date = monthFromDate(new Date());

    // rankings (si existe RPC)
    let tarotStats: any[] = [];
    const rpcRes = await db.rpc("get_tarotistas_ranking", { p_month: month_date } as any);
    if (!rpcRes.error && Array.isArray(rpcRes.data)) tarotStats = rpcRes.data as any[];

    // reglas de bonos (visible para todos)
    const { data: bonusRulesRaw, error: brErr } = await db
      .from("bonus_rules")
      .select("ranking_type, position, role, amount_eur, is_active")
      .eq("is_active", true)
      .order("ranking_type", { ascending: true })
      .order("position", { ascending: true });

    if (brErr) return NextResponse.json({ ok: false, error: brErr.message }, { status: 500 });

    const bonusRules = (bonusRulesRaw || []).map((r: any) => ({
      ranking_type: r.ranking_type,
      position: r.position,
      role: r.role,
      amount_eur: Number(r.amount_eur || 0),
    }));

    // mi earnings
    let myEarnings: any = null;
    if (meWorker?.id) {
      const { data: e } = await db
        .from("monthly_earnings")
        .select("minutes_total, captadas, amount_base_eur, amount_bonus_eur, amount_total_eur")
        .eq("month_date", month_date)
        .eq("worker_id", meWorker.id)
        .maybeSingle();

      myEarnings = e || {
        minutes_total: 0,
        captadas: 0,
        amount_base_eur: 0,
        amount_bonus_eur: 0,
        amount_total_eur: 0,
      };
    }

    // admin: earnings de todos
    let allEarnings: any[] | null = null;
    if (isAdmin) {
      const { data: all } = await db
        .from("monthly_earnings")
        .select(
          "worker_id, minutes_total, captadas, amount_total_eur, amount_base_eur, amount_bonus_eur, worker:workers(display_name, role)"
        )
        .eq("month_date", month_date)
        .order("amount_total_eur", { ascending: false });

      allEarnings = (all || []).map((x: any) => ({
        worker_id: x.worker_id,
        name: x.worker?.display_name || x.worker_id,
        role: x.worker?.role || "—",
        minutes_total: x.minutes_total || 0,
        captadas: x.captadas || 0,
        amount_base_eur: x.amount_base_eur || 0,
        amount_bonus_eur: x.amount_bonus_eur || 0,
        amount_total_eur: x.amount_total_eur || 0,
      }));
    }

    // ✅ ganador de equipos del mes (para team_win)
    // Regla: sumamos minutos_total y captadas de tarotistas del equipo, usando monthly_earnings del mes.
    // team_members debe tener: team_id, tarotista_worker_id (ya lo arreglaste).
    // teams debe tener: id, name, central_worker_id
    let winnerTeam: any | null = null;
    try {
      const { data: teams } = await db.from("teams").select("id, name, central_worker_id");
      const { data: members } = await db.from("team_members").select("team_id, tarotista_worker_id");

      if ((teams || []).length && (members || []).length) {
        const teamMap = new Map<string, { id: string; name: string; central_worker_id: string | null; memberIds: string[] }>();
        for (const t of teams as any[]) {
          teamMap.set(t.id, { id: t.id, name: t.name, central_worker_id: t.central_worker_id || null, memberIds: [] });
        }
        for (const m of members as any[]) {
          const t = teamMap.get(m.team_id);
          if (t && m.tarotista_worker_id) t.memberIds.push(m.tarotista_worker_id);
        }

        // cargamos earnings de los miembros
        const allMemberIds = Array.from(teamMap.values()).flatMap((t) => t.memberIds);
        if (allMemberIds.length) {
          const { data: earns } = await db
            .from("monthly_earnings")
            .select("worker_id, minutes_total, captadas")
            .eq("month_date", month_date)
            .in("worker_id", allMemberIds);

          const earnBy = new Map<string, { minutes_total: number; captadas: number }>();
          for (const e of (earns || []) as any[]) {
            earnBy.set(e.worker_id, { minutes_total: Number(e.minutes_total || 0), captadas: Number(e.captadas || 0) });
          }

          const scored = Array.from(teamMap.values())
            .map((t) => {
              let minutes = 0;
              let captadas = 0;
              for (const wid of t.memberIds) {
                const e = earnBy.get(wid);
                if (e) {
                  minutes += e.minutes_total;
                  captadas += e.captadas;
                }
              }
              return { ...t, total_minutes: minutes, total_captadas: captadas };
            })
            // criterio: primero minutos, luego captadas
            .sort((a, b) => b.total_minutes - a.total_minutes || b.total_captadas - a.total_captadas);

          if (scored.length) {
            const top = scored[0];
            // nombre del central:
            let centralName: string | null = null;
            if (top.central_worker_id) {
              const { data: cw } = await db.from("workers").select("display_name").eq("id", top.central_worker_id).maybeSingle();
              centralName = cw?.display_name || null;
            }
            winnerTeam = {
              team_id: top.id,
              team_name: top.name,
              central_worker_id: top.central_worker_id,
              central_name: centralName,
              total_minutes: top.total_minutes,
              total_captadas: top.total_captadas,
            };
          }
        }
      }
    } catch {
      winnerTeam = null;
    }

    return NextResponse.json({
      ok: true,
      month_date,
      user: {
        isAdmin,
        worker: meWorker || null,
      },
      rankings: {
        minutes: tarotStats,
        repite_pct: tarotStats,
        cliente_pct: tarotStats,
        captadas: tarotStats,
      },
      myEarnings,
      allEarnings,
      bonusRules,
      winnerTeam,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
