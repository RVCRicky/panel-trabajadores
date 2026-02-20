// src/app/api/admin/incidents/resolve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function firstDayOfMonth(isoDate: string) {
  // isoDate = YYYY-MM-DD
  const [y, m] = isoDate.split("-");
  return `${y}-${m}-01`;
}

type Body = {
  worker_id: string;
  incident_date?: string; // YYYY-MM-DD
  status: "justified" | "unjustified";
  notes?: string | null;
};

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.worker_id || !body?.status) {
      return NextResponse.json({ ok: false, error: "Missing worker_id/status" }, { status: 400 });
    }

    const incident_date = body.incident_date || new Date().toISOString().slice(0, 10);
    const month_date = firstDayOfMonth(incident_date);

    const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    // validar admin (usando el JWT del usuario)
    const { data: u, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !u?.user) return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
    const resolved_by = u.user.id;

    // buscamos el incidente del día (si existe)
    const { data: existing, error: exErr } = await supabase
      .from("shift_incidents")
      .select("id, kind, minutes_late, penalty_eur, status")
      .eq("worker_id", body.worker_id)
      .eq("incident_date", incident_date)
      .order("created_at", { ascending: false })
      .limit(1);

    if (exErr) return NextResponse.json({ ok: false, error: exErr.message }, { status: 400 });

    const row = existing?.[0] || null;

    // ===== Penalización automática (simple y segura) =====
    // Puedes cambiar estos valores cuando quieras.
    // - ausencia (kind = 'absence'): 10€
    // - tarde: 2€ por cada 30min (mín 2€, máx 10€)
    let penalty_eur = 0;

    if (body.status === "justified") {
      penalty_eur = 0;
    } else {
      const kind = (row?.kind || "absence").toLowerCase();
      const minutesLate = Number(row?.minutes_late || 0);

      if (kind === "absence") {
        penalty_eur = 10;
      } else if (minutesLate > 0) {
        const blocks = Math.ceil(minutesLate / 30);
        penalty_eur = Math.min(10, Math.max(2, blocks * 2));
      } else {
        // si no sabemos, mínimo 5 para NO justificada
        penalty_eur = 5;
      }
    }

    const resolved_at = new Date().toISOString();

    if (row?.id) {
      const { error: upErr } = await supabase
        .from("shift_incidents")
        .update({
          status: body.status,
          penalty_eur,
          resolved_by,
          resolved_at,
          month_date,
          notes: body.notes || null,
        })
        .eq("id", row.id);

      if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });

      return NextResponse.json({ ok: true, action: "updated", id: row.id, penalty_eur });
    }

    // Si no existe, creamos uno nuevo (manual)
    const { data: ins, error: inErr } = await supabase
      .from("shift_incidents")
      .insert({
        worker_id: body.worker_id,
        incident_date,
        month_date,
        kind: "absence",
        minutes_late: 0,
        detected_at: resolved_at,
        status: body.status,
        penalty_eur,
        admin_note: "Manual desde /admin/live",
        resolved_by,
        resolved_at,
        incident_type: "manual",
        notes: body.notes || null,
      })
      .select("id")
      .limit(1);

    if (inErr) return NextResponse.json({ ok: false, error: inErr.message }, { status: 400 });

    return NextResponse.json({ ok: true, action: "inserted", id: ins?.[0]?.id, penalty_eur });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
