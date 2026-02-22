// src/app/api/panel/me/route.ts
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

function bearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

function monthStartISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function isISODate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: Request) {
  try {
    const SUPABASE_URL = getEnvAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const SUPABASE_ANON_KEY = getEnvAny(["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    const SUPABASE_SERVICE_ROLE_KEY = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);

    const token = bearerToken(req);
    if (!token) return NextResponse.json({ ok: false, error: "Missing bearer token" }, { status: 401 });

    // 1) validar user con ANON
    const supaAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: ures, error: uerr } = await supaAuth.auth.getUser(token);
    if (uerr || !ures?.user) return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });

    const user = ures.user;

    // 2) queries con SERVICE ROLE
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // month_date desde query (si viene)
    const url = new URL(req.url);
    const qMonth = url.searchParams.get("month_date");
    const month_date = qMonth && isISODate(qMonth) ? qMonth : monthStartISO(new Date());

    // worker por user_id
    const { data: worker, error: werr } = await supa
      .from("workers")
      .select("id, user_id, role, display_name, is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (werr) throw werr;
    if (!worker || !worker.is_active) {
      return NextResponse.json({ ok: false, error: "Worker not found or inactive" }, { status: 403 });
    }

    const workerId = worker.id;

    // 3) factura del mes (fuente oficial)
    const { data: inv, error: ierr } = await supa
      .from("worker_invoices")
      .select("id, total_eur, status, updated_at, month_date, worker_id")
      .eq("worker_id", workerId)
      .eq("month_date", month_date)
      .maybeSingle();

    if (ierr) throw ierr;

    const invoice = inv
      ? {
          id: String(inv.id),
          total_eur: num((inv as any).total_eur),
          status: (inv as any).status ?? null,
          updated_at: (inv as any).updated_at ?? null,
        }
      : null;

    // 4) penalización del mes (unjustified) — por si quieres mostrarlo aquí también
    const { data: inc, error: incErr } = await supa
      .from("shift_incidents")
      .select("penalty_eur")
      .eq("worker_id", workerId)
      .eq("month_date", month_date)
      .eq("status", "unjustified");

    if (incErr) throw incErr;

    const penalty_month_eur = (inc || []).reduce((acc: number, r: any) => acc + num(r?.penalty_eur), 0);

    // 5) BONOS del mes: desde líneas de factura (si existe factura)
    // Intentamos detectar bonos por columnas típicas:
    // - kind / type / line_type
    // - concept / description / title
    // Si tu tabla tiene otra estructura, esto no rompe: solo dará 0.
    let bonuses_month_eur = 0;

    if (invoice?.id) {
      // Intento amplio (no rompe aunque algunas cols no existan: seleccionamos solo las más comunes)
      // Si alguna no existe, supabase devolverá error: reintentamos con un select mínimo.
      const trySelects = [
        "amount_eur, kind, type, line_type, concept, description, title",
        "amount_eur, kind, line_type, description",
        "amount_eur, description",
        "amount_eur",
      ];

      let lines: any[] = [];
      let lastErr: any = null;

      for (const sel of trySelects) {
        const q = await supa
          .from("worker_invoice_lines")
          .select(sel)
          .eq("invoice_id", invoice.id);

        if (q.error) {
          lastErr = q.error;
          continue;
        }

        lines = q.data || [];
        lastErr = null;
        break;
      }

      if (lastErr) {
        // si no podemos leer líneas, no rompemos panel
        bonuses_month_eur = 0;
      } else {
        const isBonus = (row: any) => {
          const s = (x: any) => String(x || "").toLowerCase();
          const tag =
            s(row.kind) ||
            s(row.type) ||
            s(row.line_type) ||
            "";

          const text =
            [row.concept, row.description, row.title]
              .map((x: any) => String(x || "").toLowerCase())
              .join(" ");

          // heurística segura
          if (tag.includes("bonus")) return true;
          if (text.includes("bonus")) return true;
          if (text.includes("bono")) return true;
          if (text.includes("premio")) return true;
          return false;
        };

        bonuses_month_eur = lines.reduce((acc: number, r: any) => {
          const a = num((r as any).amount_eur);
          return isBonus(r) ? acc + a : acc;
        }, 0);
      }
    }

    return NextResponse.json({
      ok: true,
      month_date,
      invoice,
      penalty_month_eur,
      bonuses_month_eur,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
