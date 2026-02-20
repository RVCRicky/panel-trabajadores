import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

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
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });
    const callerAuthId = u.user.id;

    // 2) query invoiceId
    const url = new URL(req.url);
    const invoiceId = (url.searchParams.get("invoiceId") || "").trim();
    if (!invoiceId) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    // 3) saber si caller es admin y/o su worker row
    const { data: callerWorker, error: cwErr } = await supabaseAdmin
      .from("workers")
      .select("id,role,is_active,user_id,display_name")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (cwErr) return NextResponse.json({ ok: false, error: cwErr.message }, { status: 400 });
    if (!callerWorker || !callerWorker.is_active) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

    const isAdmin = callerWorker.role === "admin";

    // 4) cargar invoice + worker
    const { data: inv, error: invErr } = await supabaseAdmin
      .from("worker_invoices")
      .select("id,worker_id,month_date,status,base_salary_eur,bonuses_eur,penalties_eur,total_eur,worker_note,admin_note,locked_at")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invErr) return NextResponse.json({ ok: false, error: invErr.message }, { status: 400 });
    if (!inv) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    // 5) permisos: admin o dueño
    if (!isAdmin) {
      // el worker “dueño” es el de la factura, pero en tu diseño worker_invoices.worker_id apunta a workers.id
      if (inv.worker_id !== callerWorker.id) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }
    }

    const { data: w, error: wErr } = await supabaseAdmin
      .from("workers")
      .select("display_name,role")
      .eq("id", inv.worker_id)
      .maybeSingle();

    if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });

    const workerName = w?.display_name || inv.worker_id;

    // 6) líneas
    const { data: lines, error: lErr } = await supabaseAdmin
      .from("worker_invoice_lines")
      .select("kind,label,amount_eur,is_manual,created_at")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true });

    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 400 });

    // 7) generar PDF en memoria
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

    // Header
    doc.fontSize(18).text("Factura de trabajador", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor("#444").text(`Trabajador: ${workerName}`);
    doc.text(`Mes: ${monthLabel(inv.month_date)}`);
    doc.text(`Estado: ${String(inv.status || "").toUpperCase()}  ·  ${inv.locked_at ? "CERRADA" : "ABIERTA"}`);
    doc.moveDown(0.5);
    doc.fillColor("#000").text(`Total: ${euro(inv.total_eur)}`, { align: "left" });

    doc.moveDown(1);
    doc.fontSize(12).text("Detalle", { underline: true });
    doc.moveDown(0.5);

    // Tabla simple
    const startY = doc.y;
    const col1 = 50;
    const col2 = 470;

    doc.fontSize(10).fillColor("#666");
    doc.text("Concepto", col1, startY);
    doc.text("Importe", col2, startY, { width: 80, align: "right" });
    doc.moveDown(0.5);
    doc.fillColor("#000");

    let y = doc.y + 5;

    for (const ln of (lines as any[]) || []) {
      const label = String(ln.label || "");
      const amt = euro(ln.amount_eur);

      doc.fontSize(10).text(label, col1, y, { width: 380 });
      doc.text(amt, col2, y, { width: 80, align: "right" });

      y = doc.y + 6;
      if (y > 760) {
        doc.addPage();
        y = 60;
      }
    }

    doc.moveDown(1);
    doc.fontSize(11).fillColor("#444");
    if (inv.worker_note) doc.text(`Nota trabajador: ${inv.worker_note}`);
    if (inv.admin_note) doc.text(`Nota admin: ${inv.admin_note}`);
    doc.fillColor("#000");

    doc.end();
const pdf = await done;

const filename = `factura_${workerName.replace(/\s+/g, "_")}_${inv.month_date}.pdf`;

// ✅ NextResponse (Next 15) no acepta Buffer directamente
const bytes = new Uint8Array(pdf);

return new NextResponse(bytes, {
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
