import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

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

function ymd(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeStr(v: any) {
  return String(v ?? "").trim();
}

function statusBadge(statusRaw: string) {
  const s = (statusRaw || "").toLowerCase();
  // ajusta a tus estados reales: sent/open/accepted/rejected/review/locked/etc
  if (s.includes("accept")) return { label: "ACEPTADA", color: rgb(0.12, 0.65, 0.25) };
  if (s.includes("reject")) return { label: "RECHAZADA", color: rgb(0.8, 0.15, 0.15) };
  if (s.includes("review")) return { label: "EN REVISIÓN", color: rgb(0.95, 0.62, 0.1) };
  if (s.includes("lock")) return { label: "CERRADA", color: rgb(0.35, 0.35, 0.35) };
  return { label: s ? s.toUpperCase() : "—", color: rgb(0.25, 0.25, 0.25) };
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
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const { data: u } = await supabaseAuth.auth.getUser(token);
    if (!u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const callerAuthId = u.user.id;

    // ========= Params =========
    const url = new URL(req.url);
    const invoiceId = (url.searchParams.get("invoiceId") || "").trim();
    if (!invoiceId) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    // ========= Caller Worker =========
    const { data: callerWorker, error: cwErr } = await supabaseAdmin
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (cwErr) return NextResponse.json({ ok: false, error: cwErr.message }, { status: 400 });
    if (!callerWorker || !callerWorker.is_active) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const isAdmin = callerWorker.role === "admin";

    // ========= Invoice =========
    const { data: inv, error: invErr } = await supabaseAdmin
      .from("worker_invoices")
      .select("*")
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
      .select("label, amount_eur, kind, is_manual, created_at")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true });

    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 400 });

    // ========= Company (AJUSTA AQUÍ) =========
    const COMPANY = {
      name: "TAROT CELESTIAL",
      legal: "Tarot Celestial (Servicio interno)",
      cif: "CIF: —",
      address: "Barcelona, España",
      email: "admin@tarotcelestial.com",
      web: "panel-trabajadores-tc.vercel.app",
    };

    // Número de factura pro (ej: TC-2026-01-0001)
    const monthISO = safeStr(inv.month_date || "");
    const ym = monthISO ? monthISO.slice(0, 7).replace("-", "") : "000000"; // YYYYMM
    const short = safeStr(inv.id).replace(/-/g, "").slice(0, 6).toUpperCase();
    const invoiceNumber = `TC-${ym}-${short}`;

    const issueDate = ymd(new Date()); // fecha generación
    const periodText = monthISO ? monthLabel(monthISO) : "—";
    const badge = statusBadge(safeStr(inv.status));

    // Totales (si existen en tu tabla)
    const baseSalary = Number(inv.base_salary_eur ?? 0) || 0;
    const bonuses = Number(inv.bonuses_eur ?? 0) || 0;
    const penalties = Number(inv.penalties_eur ?? 0) || 0;
    const total = Number(inv.total_eur ?? 0) || 0;

    // =========================
    // PDF PRO (pdf-lib / Vercel OK)
    // =========================
    const pdfDoc = await PDFDocument.create();

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const M = 48;

    const TABLE_X = M;
    const TABLE_W = PAGE_W - M * 2;
    const COL_AMOUNT_W = 110;
    const COL_LABEL_W = TABLE_W - COL_AMOUNT_W;

    const HEADER_H = 150;
    const FOOTER_H = 50;

    const lineColor = rgb(0.85, 0.85, 0.88);
    const textGray = rgb(0.35, 0.35, 0.38);
    const brand = rgb(0.35, 0.05, 0.48); // morado
    const lightBrand = rgb(0.93, 0.90, 0.96);

    // helper para nueva página
    const pages: any[] = [];
    const newPage = () => {
      const p = pdfDoc.addPage([PAGE_W, PAGE_H]);
      pages.push(p);
      return p;
    };

    let page = newPage();
    let y = PAGE_H - M;

    // Watermark
    const drawWatermark = (p: any) => {
      p.drawText(COMPANY.name, {
        x: 80,
        y: 360,
        size: 60,
        font: fontBold,
        color: rgb(0.9, 0.9, 0.92),
        rotate: degrees(25),
        opacity: 0.35,
      });
    };
    drawWatermark(page);

    // Header box
    page.drawRectangle({
      x: 0,
      y: PAGE_H - HEADER_H,
      width: PAGE_W,
      height: HEADER_H,
      color: lightBrand,
    });

    // Logo (auto fit en caja)
    const LOGO_BOX_W = 120;
    const LOGO_BOX_H = 52;
    const LOGO_X = M;
    const LOGO_Y_TOP = PAGE_H - 40;

    try {
      const logoUrl = new URL("/logo.png", req.url).toString();
      const logoRes = await fetch(logoUrl);
      if (logoRes.ok) {
        const logoBytes = await logoRes.arrayBuffer();
        const logoImage = await pdfDoc.embedPng(logoBytes);

        const imgW = logoImage.width;
        const imgH = logoImage.height;

        const scale = Math.min(LOGO_BOX_W / imgW, LOGO_BOX_H / imgH);
        const w2 = imgW * scale;
        const h2 = imgH * scale;

        page.drawImage(logoImage, {
          x: LOGO_X,
          y: LOGO_Y_TOP - h2, // alinear desde arriba
          width: w2,
          height: h2,
        });
      }
    } catch {
      // si falla, no rompemos
    }

    // Company name + info (derecha)
    page.drawText(COMPANY.name, {
      x: PAGE_W - M - 230,
      y: PAGE_H - 48,
      size: 18,
      font: fontBold,
      color: brand,
    });

    page.drawText(COMPANY.legal, {
      x: PAGE_W - M - 230,
      y: PAGE_H - 68,
      size: 10,
      font: fontRegular,
      color: textGray,
    });

    page.drawText(COMPANY.cif, {
      x: PAGE_W - M - 230,
      y: PAGE_H - 84,
      size: 10,
      font: fontRegular,
      color: textGray,
    });

    page.drawText(COMPANY.address, {
      x: PAGE_W - M - 230,
      y: PAGE_H - 100,
      size: 10,
      font: fontRegular,
      color: textGray,
    });

    page.drawText(`${COMPANY.email} · ${COMPANY.web}`, {
      x: PAGE_W - M - 230,
      y: PAGE_H - 116,
      size: 10,
      font: fontRegular,
      color: textGray,
    });

    // Factura info (izquierda debajo del logo)
    page.drawText("FACTURA", {
      x: M,
      y: PAGE_H - 105,
      size: 14,
      font: fontBold,
      color: brand,
    });

    page.drawText(`Nº: ${invoiceNumber}`, {
      x: M,
      y: PAGE_H - 125,
      size: 10.5,
      font: fontRegular,
      color: rgb(0.15, 0.15, 0.18),
    });

    page.drawText(`Fecha emisión: ${issueDate}`, {
      x: M,
      y: PAGE_H - 141,
      size: 10.5,
      font: fontRegular,
      color: rgb(0.15, 0.15, 0.18),
    });

    // Badge estado (arriba derecha)
    const badgeW = 120;
    const badgeH = 22;
    const bx = PAGE_W - M - badgeW;
    const by = PAGE_H - 140;
    page.drawRectangle({ x: bx, y: by, width: badgeW, height: badgeH, color: badge.color, borderColor: badge.color });
    page.drawText(badge.label, {
      x: bx + 10,
      y: by + 6,
      size: 10,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    // Worker box
    const boxY = PAGE_H - HEADER_H - 22;
    page.drawRectangle({
      x: M,
      y: boxY,
      width: PAGE_W - M * 2,
      height: 58,
      borderColor: lineColor,
      borderWidth: 1,
      color: rgb(1, 1, 1),
    });

    page.drawText("Trabajador", { x: M + 14, y: boxY + 38, size: 10, font: fontBold, color: textGray });
    page.drawText(workerName, { x: M + 14, y: boxY + 20, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.15) });

    page.drawText("Periodo", { x: M + 320, y: boxY + 38, size: 10, font: fontBold, color: textGray });
    page.drawText(periodText, { x: M + 320, y: boxY + 20, size: 12, font: fontBold, color: rgb(0.12, 0.12, 0.15) });

    // Start table
    y = boxY - 24;

    const drawTableHeader = () => {
      // header row background
      page.drawRectangle({
        x: TABLE_X,
        y: y - 18,
        width: TABLE_W,
        height: 22,
        color: rgb(0.96, 0.96, 0.98),
        borderColor: lineColor,
        borderWidth: 1,
      });

      page.drawText("Concepto", { x: TABLE_X + 10, y: y - 12, size: 10.5, font: fontBold, color: textGray });
      page.drawText("Importe (€)", {
        x: TABLE_X + COL_LABEL_W + 10,
        y: y - 12,
        size: 10.5,
        font: fontBold,
        color: textGray,
      });

      y -= 28;
    };

    const ensureSpace = (need: number) => {
      if (y - need < FOOTER_H) {
        // footer on current page
        drawFooter(page);
        // new page
        page = newPage();
        drawWatermark(page);
        // mini header on subsequent pages
        drawMiniHeader(page);
        y = PAGE_H - M - 50;
        drawTableHeader();
      }
    };

    const drawMiniHeader = (p: any) => {
      // top line
      p.drawLine({
        start: { x: M, y: PAGE_H - M + 6 },
        end: { x: PAGE_W - M, y: PAGE_H - M + 6 },
        thickness: 1,
        color: lineColor,
      });
      p.drawText(`${COMPANY.name} · Factura ${invoiceNumber}`, {
        x: M,
        y: PAGE_H - M - 10,
        size: 10,
        font: fontBold,
        color: brand,
      });
      p.drawText(`Trabajador: ${workerName} · Periodo: ${periodText}`, {
        x: M,
        y: PAGE_H - M - 26,
        size: 9.5,
        font: fontRegular,
        color: textGray,
      });
    };

    const drawFooter = (p: any) => {
      const footerY = 28;
      p.drawLine({
        start: { x: M, y: footerY + 18 },
        end: { x: PAGE_W - M, y: footerY + 18 },
        thickness: 1,
        color: lineColor,
      });
      p.drawText(`Generado: ${new Date().toLocaleString("es-ES")}`, {
        x: M,
        y: footerY,
        size: 9,
        font: fontRegular,
        color: textGray,
      });
      p.drawText(COMPANY.web, {
        x: PAGE_W - M - 160,
        y: footerY,
        size: 9,
        font: fontRegular,
        color: textGray,
      });
    };

    drawTableHeader();

    // Table rows
    const rowH = 20;
    const rows = (lines || []) as any[];

    for (let i = 0; i < rows.length; i++) {
      ensureSpace(rowH + 6);

      const ln = rows[i];
      const isAlt = i % 2 === 1;

      if (isAlt) {
        page.drawRectangle({
          x: TABLE_X,
          y: y - 14,
          width: TABLE_W,
          height: rowH,
          color: rgb(0.99, 0.99, 1),
        });
      }

      const label = safeStr(ln.label);
      const amt = euro(ln.amount_eur);

      // concepto
      page.drawText(label.length > 90 ? label.slice(0, 87) + "..." : label, {
        x: TABLE_X + 10,
        y: y - 10,
        size: 10.5,
        font: fontRegular,
        color: rgb(0.12, 0.12, 0.15),
      });

      // importe derecha
      page.drawText(amt, {
        x: TABLE_X + COL_LABEL_W + 10,
        y: y - 10,
        size: 10.5,
        font: fontRegular,
        color: rgb(0.12, 0.12, 0.15),
      });

      y -= rowH;
    }

    // Totals box
    ensureSpace(120);

    y -= 10;
    page.drawLine({
      start: { x: TABLE_X, y: y },
      end: { x: TABLE_X + TABLE_W, y: y },
      thickness: 1,
      color: lineColor,
    });
    y -= 18;

    const totalsX = TABLE_X + TABLE_W - 260;
    const totalsY = y;

    page.drawRectangle({
      x: totalsX,
      y: totalsY - 88,
      width: 260,
      height: 92,
      borderColor: lineColor,
      borderWidth: 1,
      color: rgb(1, 1, 1),
    });

    const txL = totalsX + 12;
    const txR = totalsX + 160;

    const drawTotalRow = (lbl: string, val: string, yy: number, bold = false) => {
      page.drawText(lbl, { x: txL, y: yy, size: 10.5, font: bold ? fontBold : fontRegular, color: textGray });
      page.drawText(val, { x: txR, y: yy, size: 10.5, font: bold ? fontBold : fontRegular, color: rgb(0.12, 0.12, 0.15) });
    };

    let ty = totalsY - 18;
    drawTotalRow("Sueldo base", euro(baseSalary), ty);
    ty -= 16;
    drawTotalRow("Extras / Bonos", euro(bonuses), ty);
    ty -= 16;
    drawTotalRow("Sanciones", euro(penalties), ty);
    ty -= 18;

    // Total final resaltado
    page.drawLine({
      start: { x: totalsX + 12, y: ty + 10 },
      end: { x: totalsX + 248, y: ty + 10 },
      thickness: 1,
      color: lineColor,
    });

    drawTotalRow("TOTAL", euro(total), ty - 4, true);

    // Notes
    y = totalsY - 110;
    const wn = safeStr(inv.worker_note);
    const an = safeStr(inv.admin_note);

    if (wn || an) {
      ensureSpace(80);

      page.drawText("Notas", { x: TABLE_X, y, size: 11, font: fontBold, color: textGray });
      y -= 16;

      if (wn) {
        page.drawText(`Trabajador: ${wn}`.slice(0, 180), {
          x: TABLE_X,
          y,
          size: 10,
          font: fontRegular,
          color: rgb(0.12, 0.12, 0.15),
        });
        y -= 14;
      }

      if (an) {
        page.drawText(`Admin: ${an}`.slice(0, 180), {
          x: TABLE_X,
          y,
          size: 10,
          font: fontRegular,
          color: rgb(0.12, 0.12, 0.15),
        });
        y -= 14;
      }
    }

    // Signature
    ensureSpace(90);
    y -= 20;
    page.drawText("Firma del trabajador:", { x: TABLE_X, y, size: 11, font: fontRegular, color: textGray });
    y -= 30;
    page.drawLine({ start: { x: TABLE_X, y }, end: { x: TABLE_X + 260, y }, thickness: 1, color: lineColor });

    // Footer on last page + pagination
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      drawFooter(p);
      p.drawText(`Página ${i + 1} / ${pages.length}`, {
        x: PAGE_W - M - 90,
        y: 46,
        size: 9,
        font: fontRegular,
        color: textGray,
      });
    }

    // Save
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
