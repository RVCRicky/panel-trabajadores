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

type Body = {
  worker_id: string; // tarotista worker_id
  incident_date?: string; // YYYY-MM-DD (opcional)
  kind: string; // ejemplo: "late" | "absence" | "call_missed" | ...
  minutes_late?: number;
  notes?: string;
};

function monthDateFromDay(dayISO: string) {
  // "YYYY-MM-01"
  const [y, m] = String(dayISO).split("-");
  return `${y}-${m}-01`;
}

export async function POST(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.worker_id || !body?.kind) return NextResponse.json({ ok: false, error: "BAD_BODY" }, { status: 400 });

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
    if (role !== "central" && role !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const incident_date = body.incident_date || new Date().toISOString().slice(0, 10);
    const month_date = monthDateFromDay(incident_date);

    // crear incidencia manual como "pending" para que admin la revise
    const { data: created, error: eIns } = await db
      .from("shift_incidents")
      .insert({
        worker_id: body.worker_id,
        incident_date,
        month_date,
        kind: body.kind,
        incident_type: body.kind, // por compatibilidad si tu tabla usa uno u otro
        minutes_late: body.minutes_late ?? null,
        status: "pending",
        notes: body.notes ? String(body.notes) : "Creada manualmente por central",
      } as any)
      .select("id")
      .maybeSingle();

    if (eIns) return NextResponse.json({ ok: false, error: eIns.message }, { status: 500 });

    return NextResponse.json({ ok: true, id: created?.id || null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
