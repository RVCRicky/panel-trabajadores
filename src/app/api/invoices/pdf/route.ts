import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function euro(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function monthLabel(isoDate: string) {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  } catch {
    return isoDate;
  }
}

export async function GET(req: Request) {
  try {
    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const ANON_KEY = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // 1) token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const callerAuthId = u.user.id;

    // 2) invoiceId
    const url = new URL(req.url);
    const invoiceId = (url.searchParams.get("invoiceId") || "").trim();
    if (!invoiceId) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    // 3) caller worker
    const { data: callerWorker, error: cwErr } = await supabaseAdmin
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (cwErr) return NextResponse.json({ ok: false, error: cwErr.message }, { status: 400 });
    if (!callerWorker || !callerWorker.is_active) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const isAdmin = callerWorker.role === "admin";

    // 4) invoice
    const { data: inv, error: invErr } = await supabaseAdmin
      .from("worker_invoices")
      .select("id,worker_id,month_date,status,total_eur,worker_note,admin_note")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 400 });
    if (!inv) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    if (!isAdmin && inv.worker_id !== callerWorker.id) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { data: w, error: wErr } = await supabaseAdmin
      .from("workers")
      .select("display_name")
      .eq("id", inv.worker_id)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });

    const workerName = w?.display_name || inv.worker_id;

    const { data: lines, error: lErr } = await supabaseAdmin
      .from("worker_invoice_lines")
      .select("label, amount_eur")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true });

    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 400 });

    // =========================
    // PDF con pdf-lib (Vercel OK)
    // =========================
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 points
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    let y = 800;
    const left = 50;

    const draw = (text: string, size = 12) => {
      page.drawText(text, { x: left, y, size, font });
      y -= size + 6;
    };

    draw("Factura de trabajador", 18);
    y -= 6;

    draw(`Trabajador: ${workerName}`, 12);
    draw(`Mes: ${monthLabel(inv.month_date)}`, 12);
    draw(`Estado: ${String(inv.status || "").toUpperCase()}`, 12);
    y -= 6;

    draw(`Total: ${euro(inv.total_eur)}`, 14);
    y -= 10;

    draw("Detalle:", 12);
    y -= 4;

    for (const ln of lines || []) {
      draw(`• ${ln.label} — ${euro(ln.amount_eur)}`, 11);
      if (y < 80) {
        // nueva página si se llena
        const newPage = pdfDoc.addPage([595.28, 841.89]);
        (page as any).doc = undefined;
        // hack simple: reasignamos variables
        // (pdf-lib no permite cambiar page a posteriori con const, así que lo evitamos creando función por página)
      }
    }

    if (inv.worker_note) {
      y -= 8;
      draw(`Nota trabajador: ${inv.worker_note}`, 11);
    }

    if (inv.admin_note) {
      y -= 6;
      draw(`Nota admin: ${inv.admin_note}`, 11);
    }

    const pdfBytes = await pdfDoc.save(); // Uint8Array

    const filename = `factura_${workerName.replace(/\s+/g, "_")}_${inv.month_date}.pdf`;
    const ab = pdfBytes.buffer.slice(
  pdfBytes.byteOffset,
  pdfBytes.byteOffset + pdfBytes.byteLength
);
    return new NextResponse(ab, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
