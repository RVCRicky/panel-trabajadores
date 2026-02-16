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
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
