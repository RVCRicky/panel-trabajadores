// src/app/api/admin/incidents/action/route.ts
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
      .select("id, worker_id, month_date, status")
      .eq("id", body.id)
      .maybeSingle();

    if (eInc) return NextResponse.json({ ok: false, error: eInc.message }, { status: 500 });
    if (!inc) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    // ✅ CHECK en BD solo permite: pending | justified | unjustified
    let newStatus: "pending" | "justified" | "unjustified" = (String(inc.status || "pending") as any);

    // dismiss = quitar sin penalizar (lo marcamos justified)
    if (body.action === "dismiss") newStatus = "justified";
    if (body.action === "justified") newStatus = "justified";
    if (body.action === "unjustified") newStatus = "unjustified";

    const note =
      body.action === "dismiss"
        ? "Quitada (sin penalizar) desde /admin/incidents"
        : body.action === "justified"
        ? "Marcada como justificada desde /admin/incidents"
        : "Marcada como NO justificada desde /admin/incidents";

    const { error: eUp } = await db
      .from("shift_incidents")
      .update({
        status: newStatus,
        notes: note,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", body.id);

    if (eUp) return NextResponse.json({ ok: false, error: eUp.message }, { status: 500 });

    // 🔁 best-effort recalc invoice (si existe)
    try {
      const wid = String((inc as any).worker_id || "");
      const m = (inc as any).month_date;

      if (wid && m) {
        const { data: inv, error: eInv } = await db
          .from("worker_invoices")
          .select("id")
          .eq("worker_id", wid)
          .eq("month_date", m)
          .maybeSingle();

        if (!eInv && inv?.id) {
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
