import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

    // ========= AUTH =========
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const { data: u } = await supabaseAuth.auth.getUser(token);
    if (!u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const callerAuthId = u.user.id;

    const url = new URL(req.url);
    const invoiceId = (url.searchParams.get("invoiceId") || "").trim();
    if (!invoiceId) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    const { data: callerWorker } = await supabaseAdmin
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (!callerWorker || !callerWorker.is_active)
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const isAdmin = callerWorker.role === "admin";

    const { data: inv } = await supabaseAdmin
      .from("worker_invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!inv) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    if (!isAdmin && inv.worker_id !== callerWorker.id)
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const { data: w } = await supabaseAdmin
      .from("workers")
      .select("display_name")
      .eq("id", inv.worker_id)
      .maybeSingle();

    const workerName = w?.display_name || inv.worker_id;

    const { data: lines } = await supabaseAdmin
      .from("worker_invoice_lines")
      .select("label, amount_eur")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true });

    // =========================
    // PDF PROFESIONAL
    // =========================

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595.28, 841.89]); // A4
    const { width } = page.getSize();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 50;
    let y = 800;

    // ========= LOGO =========
    try {
      const logoUrl = new URL("/logo.png", req.url).toString();
      const logoRes = await fetch(logoUrl);
      const logoBytes = await logoRes.arrayBuffer();
      const logoImage = await pdfDoc.embedPng(logoBytes);

      const scaled = logoImage.scale(0.35);

      page.drawImage(logoImage, {
        x: margin,
        y: y - 40,
        width: scaled.width,
        height: scaled.height,
      });
    } catch {
      // Si falla el logo no rompe el PDF
    }

    // ========= CABECERA =========
    page.drawText("TAROT CELESTIAL", {
      x: width - 230,
      y,
      size: 18,
      font: fontBold,
      color: rgb(0.3, 0, 0.4),
    });

    y -= 40;

    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
      color: rgb(0.7, 0.7, 0.7),
    });

    y -= 30;

    page.drawText(`Trabajador: ${workerName}`, { x: margin, y, size: 12, font: fontRegular });
    y -= 18;

    page.drawText(`Periodo: ${monthLabel(inv.month_date)}`, { x: margin, y, size: 12, font: fontRegular });
    y -= 18;

    page.drawText(`Estado: ${String(inv.status).toUpperCase()}`, { x: margin, y, size: 12, font: fontBold });
    y -= 30;

    // ========= DETALLE =========
    page.drawText("Detalle de conceptos", { x: margin, y, size: 14, font: fontBold });
    y -= 20;

    for (const ln of (lines || []) as any[]) {
      page.drawText(ln.label, {
        x: margin,
        y,
        size: 11,
        font: fontRegular,
      });

      page.drawText(euro(ln.amount_eur), {
        x: width - margin - 100,
        y,
        size: 11,
        font: fontRegular,
      });

      y -= 18;
    }

    y -= 10;

    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 1,
    });

    y -= 25;

    page.drawText("TOTAL:", {
      x: width - margin - 200,
      y,
      size: 14,
      font: fontBold,
    });

    page.drawText(euro(inv.total_eur), {
      x: width - margin - 100,
      y,
      size: 14,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });

    y -= 60;

    // ========= FIRMA =========
    page.drawText("Firma trabajador:", {
      x: margin,
      y,
      size: 12,
      font: fontRegular,
    });

    y -= 40;

    page.drawLine({
      start: { x: margin, y },
      end: { x: margin + 200, y },
      thickness: 1,
    });

    // ========= SAVE =========
    const pdfBytes = await pdfDoc.save();
    const buf = Buffer.from(pdfBytes);

    const filename = `factura_${workerName.replace(/\s+/g, "_")}_${inv.month_date}.pdf`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
