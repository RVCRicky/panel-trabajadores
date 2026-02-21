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

type Body = { id: string; action: "justified" | "unjustified" | "dismiss" };

// ✅ Penalización mínima por defecto (por ahora)
// Luego lo hacemos pro con leves/moderadas/graves automático.
function defaultPenaltyFor(inc: any) {
  const kind = String(inc?.kind || inc?.incident_type || "").toLowerCase();

  // ejemplo: ausencia injustificada suele ser más grave, pero de momento:
  if (kind === "absence") return 3;

  // retraso / llamada / etc
  return 0.5;
}

export async function POST(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.id || !body?.action) return NextResponse.json({ ok: false, error: "BAD_BODY" }, { status: 400 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // auth
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    // worker + role
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const role = normRole((me as any).role);
    if (role !== "admin") return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    // cargar incidencia
    const { data: inc, error: eInc } = await db
      .from("shift_incidents")
      .select("id, worker_id, month_date, status, kind, incident_type, penalty_eur")
      .eq("id", body.id)
      .maybeSingle();

    if (eInc) return NextResponse.json({ ok: false, error: eInc.message }, { status: 500 });
    if (!inc) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    // ✅ status que coincide con tu CHECK: pending/justified/unjustified
    let newStatus: "pending" | "justified" | "unjustified" = (String(inc.status || "pending") as any) || "pending";

    if (body.action === "dismiss") newStatus = "justified"; // "quitar" = no penaliza y no molesta
    if (body.action === "justified") newStatus = "justified";
    if (body.action === "unjustified") newStatus = "unjustified";

    const note =
      body.action === "dismiss"
        ? "Quitada desde /admin/incidents"
        : body.action === "justified"
        ? "Marcada como JUSTIFICADA desde /admin/incidents"
        : "Marcada como NO JUSTIFICADA desde /admin/incidents";

    // ✅ si es unjustified, guarda penalty_eur (si no existe o es 0)
    const currentPenalty = Number((inc as any).penalty_eur) || 0;
    const penaltyToSet =
      body.action === "unjustified"
        ? (currentPenalty > 0 ? currentPenalty : defaultPenaltyFor(inc))
        : 0;

    const patch: any = {
      status: newStatus,
      notes: note,
      updated_at: new Date().toISOString(),
    };

    if (body.action === "unjustified") {
      patch.penalty_eur = penaltyToSet;
    } else if (body.action === "justified" || body.action === "dismiss") {
      patch.penalty_eur = 0;
    }

    const { error: eUp } = await db.from("shift_incidents").update(patch).eq("id", body.id);
    if (eUp) return NextResponse.json({ ok: false, error: eUp.message }, { status: 500 });

    // best effort: recalcular factura si existe
    try {
      const wid = String((inc as any).worker_id || "");
      const m = (inc as any).month_date;

      if (wid && m) {
        const { data: inv } = await db
          .from("worker_invoices")
          .select("id")
          .eq("worker_id", wid)
          .eq("month_date", m)
          .maybeSingle();

        if (inv?.id) {
          try {
            await db.rpc("recalc_invoice", { p_invoice_id: inv.id });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
