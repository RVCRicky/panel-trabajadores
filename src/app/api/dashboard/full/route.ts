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

function round1(n: number) {
  return Math.round((n + Number.EPSILON) * 10) / 10;
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

    // admin flag
    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", uid).maybeSingle();
    const isAdmin = !!adminRow;

    // mi worker
    const { data: meWorker, error: wErr } = await db
      .from("workers")
      .select("id, user_id, role, display_name")
      .eq("user_id", uid)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 500 });

    const month_date = monthFromDate(new Date());

    // =========================
    // 1) Rankings robustos (SIN RPC)
    // =========================
    // Desde attendance_rows del mes, agrupando por worker, y devolviendo:
    // minutes, captadas, repite_pct, cliente_pct
    const { data: tarotRows, error: trErr } = await db
      .from("attendance_rows")
      .select("worker_id, minutes, codigo, captado")
      .eq("month_date", month_date);

    if (trErr) return NextResponse.json({ ok: false, error: trErr.message }, { status: 500 });

    const byWorker = new Map<
      string,
      { minutes: number; free: number; rueda: number; cliente: number; repite: number; captadas: number }
    >();

    for (const r of (tarotRows || []) as any[]) {
      const wid = r.worker_id as string;
      if (!wid) continue;
      const m = Number(r.minutes || 0);
      const codigo = String(r.codigo || "").toLowerCase();
      const cap = r.captado === true;

      if (!byWorker.has(wid)) byWorker.set(wid, { minutes: 0, free: 0, rueda: 0, cliente: 0, repite: 0, captadas: 0 });
      const agg = byWorker.get(wid)!;

      agg.minutes += m;
      if (codigo === "free") agg.free += m;
      else if (codigo === "rueda") agg.rueda += m;
      else if (codigo === "cliente") agg.cliente += m;
      else if (codigo === "repite") agg.repite += m;

      if (cap) agg.captadas += 1;
    }

    // nombres (workers)
    const workerIds = Array.from(byWorker.keys());
    let namesMap = new Map<string, { name: string; role: string }>();
    if (workerIds.length) {
      const { data: ws } = await db.from("workers").select("id, display_name, role").in("id", workerIds);
      for (const w of (ws || []) as any[]) {
        namesMap.set(w.id, { name: w.display_name || w.id, role: w.role || "tarotista" });
      }
    }

    // construimos lista ranking tarotistas (solo role tarotista)
    const tarotStats = Array.from(byWorker.entries())
      .map(([worker_id, a]) => {
        const w = namesMap.get(worker_id) || { name: worker_id, role: "tarotista" };
        const minutes = a.minutes;
        const repite_pct = minutes > 0 ? round1((a.repite / minutes) * 100) : 0;
        const cliente_pct = minutes > 0 ? round1((a.cliente / minutes) * 100) : 0;
        return {
          worker_id,
          name: w.name,
          role: w.role,
          minutes,
          captadas: a.captadas,
          free: a.free,
          rueda: a.rueda,
          cliente: a.cliente,
          repite: a.repite,
          repite_pct,
          cliente_pct,
        };
      })
      .filter((x) => String(x.role).toLowerCase() === "tarotista");

    const sortDesc = (key: string) => (a: any, b: any) => Number(b[key] || 0) - Number(a[key] || 0);

    const rankings = {
      minutes: [...tarotStats].sort(sortDesc("minutes")),
      captadas: [...tarotStats].sort(sortDesc("captadas")),
      repite_pct: [...tarotStats].sort(sortDesc("repite_pct")),
      cliente_pct: [...tarotStats].sort(sortDesc("cliente_pct")),
    };

    // =========================
    // 2) Reglas de bonos (filtrando team_winner y minutes)
    // =========================
    const { data: bonusRulesRaw, error: brErr } = await db
      .from("bonus_rules")
      .select("ranking_type, position, role, amount_eur, is_active")
      .eq("is_active", true)
      .order("ranking_type", { ascending: true })
      .order("position", { ascending: true });

    if (brErr) return NextResponse.json({ ok: false, error: brErr.message }, { status: 500 });

    const bonusRules = (bonusRulesRaw || [])
      .filter((r: any) => {
        const rt = String(r.ranking_type || "").toLowerCase();
        if (rt === "minutes") return false; // no premiamos minutos
        if (rt === "team_winner") return false; // no lo usaremos
        return true;
      })
      .map((r: any) => ({
        ranking_type: r.ranking_type,
        position: r.position,
        role: r.role,
        amount_eur: Number(r.amount_eur || 0),
      }));

    // =========================
    // 3) Earnings (si existen) - para “Ganado”
    // =========================
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

    // =========================
    // 4) Ganador de equipos (desde attendance_rows del mes) ✅ (siempre habrá datos tras Sync)
    // =========================
    let winnerTeam: any | null = null;
    try {
      const { data: teams } = await db.from("teams").select("id, name, central_worker_id");
      const { data: members } = await db.from("team_members").select("team_id, tarotista_worker_id");

      if ((teams || []).length && (members || []).length) {
        const teamMap = new Map<
          string,
          { id: string; name: string; central_worker_id: string | null; memberIds: string[] }
        >();

        for (const t of teams as any[]) {
          teamMap.set(t.id, { id: t.id, name: t.name, central_worker_id: t.central_worker_id || null, memberIds: [] });
        }
        for (const m of members as any[]) {
          const tm = teamMap.get(m.team_id);
          if (tm && m.tarotista_worker_id) tm.memberIds.push(m.tarotista_worker_id);
        }

        // sumamos desde byWorker (attendance_rows) -> siempre existe tras sync
        const scored = Array.from(teamMap.values())
          .map((t) => {
            let minutes = 0;
            let captadas = 0;
            for (const wid of t.memberIds) {
              const a = byWorker.get(wid);
              if (a) {
                minutes += a.minutes;
                captadas += a.captadas;
              }
            }
            return { ...t, total_minutes: minutes, total_captadas: captadas };
          })
          .sort((a, b) => b.total_minutes - a.total_minutes || b.total_captadas - a.total_captadas);

        if (scored.length) {
          const top = scored[0];
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
      rankings,
      myEarnings,
      allEarnings,
      bonusRules,
      winnerTeam,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
