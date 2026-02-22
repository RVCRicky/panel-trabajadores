// src/app/api/panel/me/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function monthDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function GET(req: Request) {
  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SUPABASE_ANON_KEY = getEnv("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });
    }

    const supaAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userRes, error: userErr } = await supaAuth.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
    }

    const user = userRes.user;

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: w, error: wErr } = await supa
      .from("workers")
      .select("worker_id, role, display_name, is_active, user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (wErr) throw wErr;
    if (!w?.worker_id) {
      return NextResponse.json(
        { ok: false, error: "Worker not found for user", user_id: user.id },
        { status: 404 }
      );
    }

    const month_date = monthDateISO(new Date());

    const { data: inv, error: invErr } = await supa
      .from("worker_invoices")
      .select("id, worker_id, month_date, total_eur, status, updated_at")
      .eq("worker_id", w.worker_id)
      .eq("month_date", month_date)
      .maybeSingle();

    if (invErr) throw invErr;

    const { data: penRows, error: penErr } = await supa
      .from("shift_incidents")
      .select("penalty_eur")
      .eq("worker_id", w.worker_id)
      .eq("month_date", month_date)
      .eq("status", "unjustified");

    if (penErr) throw penErr;

    const penalty_month_eur =
      (penRows || []).reduce((acc, r: any) => acc + (Number(r?.penalty_eur) || 0), 0);

    // Bonos del mes: suma de líneas marcadas como bonus
    // (Si tus columnas son distintas, me dices y lo ajusto)
    let bonuses_month_eur = 0;

    if (inv?.id) {
      const { data: lines, error: linesErr } = await supa
        .from("worker_invoice_lines")
        .select("amount_eur, kind, type, category, source")
        .eq("invoice_id", inv.id);

      if (linesErr) throw linesErr;

      const isBonus = (r: any) => {
        const k = String(r?.kind || "").toLowerCase();
        const t = String(r?.type || "").toLowerCase();
        const c = String(r?.category || "").toLowerCase();
        const s = String(r?.source || "").toLowerCase();
        return k === "bonus" || t === "bonus" || c === "bonus" || s === "bonus";
      };

      bonuses_month_eur = (lines || [])
        .filter(isBonus)
        .reduce((acc, r: any) => acc + (Number(r?.amount_eur) || 0), 0);
    }

    return NextResponse.json({
      ok: true,
      month_date,
      worker: {
        worker_id: w.worker_id,
        display_name: w.display_name,
        role: w.role,
        is_active: w.is_active,
      },
      invoice: inv
        ? {
            id: inv.id,
            total_eur: Number(inv.total_eur) || 0,
            status: inv.status,
            updated_at: inv.updated_at,
          }
        : null,
      penalty_month_eur,
      bonuses_month_eur,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
