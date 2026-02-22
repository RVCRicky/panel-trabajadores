// src/app/api/incidents/create/route.ts
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

function clean(s: any) {
  return String(s || "").trim();
}

function toNum(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function isoDateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// month_date => YYYY-MM-01
function monthDateFromIso(isoDate: string) {
  const [y, m] = String(isoDate || "").split("-");
  const yy = Number(y);
  const mm = Number(m);
  if (!yy || !mm) return null;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-01`;
}

export async function POST(req: Request) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as any;
    if (!body) return NextResponse.json({ ok: false, error: "BAD_BODY" }, { status: 400 });

    const targetName = clean(body.target_name);
    const kindRaw = clean(body.kind).toLowerCase(); // late|absence|call|other
    const notesIn = clean(body.notes);
    const incidentDate = clean(body.incident_date) || isoDateOnly(new Date());
    const minutesLate = Math.max(0, Math.floor(toNum(body.minutes_late)));

    if (!targetName) return NextResponse.json({ ok: false, error: "MISSING_TARGET_NAME" }, { status: 400 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const db = createClient(url, service, { auth: { persistSession: false } });

    // auth
    const { data: u, error: eu } = await db.auth.getUser(token);
    if (eu || !u?.user) return NextResponse.json({ ok: false, error: "BAD_TOKEN" }, { status: 401 });

    // worker + role
    const { data: me, error: eme } = await db
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", u.user.id)
      .maybeSingle();

    if (eme) return NextResponse.json({ ok: false, error: eme.message }, { status: 500 });
    if (!me) return NextResponse.json({ ok: false, error: "NO_WORKER" }, { status: 403 });
    if (!(me as any).is_active) return NextResponse.json({ ok: false, error: "INACTIVE" }, { status: 403 });

    const myRole = normRole((me as any).role);
    if (myRole !== "central" && myRole !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    // buscar tarotista por display_name (case-insensitive exact-ish)
    // Nota: si tenéis nombres duplicados, lo ideal es pasar worker_id desde un dropdown. De momento ok.
    const { data: target, error: et } = await db
      .from("workers")
      .select("id, role, display_name, is_active")
      .ilike("display_name", targetName)
      .maybeSingle();

    if (et) return NextResponse.json({ ok: false, error: et.message }, { status: 500 });
    if (!target) return NextResponse.json({ ok: false, error: "TAROTIST_NOT_FOUND" }, { status: 404 });
    if (!(target as any).is_active) return NextResponse.json({ ok: false, error: "TARGET_INACTIVE" }, { status: 400 });
    if (normRole((target as any).role) !== "tarotista") return NextResponse.json({ ok: false, error: "TARGET_NOT_TAROTIST" }, { status: 400 });

    const month_date = monthDateFromIso(incidentDate);
    if (!month_date) return NextResponse.json({ ok: false, error: "BAD_INCIDENT_DATE" }, { status: 400 });

    // Compatibilidad con admin:
    // - status: pending/justified/unjustified
    // - kind / incident_type (en vuestro list se muestran ambos)
    const kind =
      kindRaw === "late" || kindRaw === "absence" || kindRaw === "call" || kindRaw === "other"
        ? kindRaw
        : "other";

    const incident_type = kind; // simple y consistente

    // ✅ seguridad: central no pone unjustified ni penalty (eso lo decide admin)
    const status = "pending";
    const penalty_eur = 0;

    const notes = [
      `Creada por ${myRole.toUpperCase()} (${clean((me as any).display_name) || String((me as any).id).slice(0, 8)})`,
      notesIn ? `Notas: ${notesIn}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const payload: any = {
      worker_id: String((target as any).id),
      incident_date: incidentDate,
      month_date,
      kind,
      incident_type,
      status,
      penalty_eur,
      notes: notes || null,
    };

    if (kind === "late") payload.minutes_late = minutesLate || 0;

    const { data: ins, error: ein } = await db.from("shift_incidents").insert(payload).select("id").maybeSingle();
    if (ein) return NextResponse.json({ ok: false, error: ein.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      id: ins?.id || null,
      created_for: (target as any).display_name || null,
      status,
      penalty_eur,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
