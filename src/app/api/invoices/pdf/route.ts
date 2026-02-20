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

    // ===== AUTH =====
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });
    }

    const { data: u, error: uErr } = await supabaseAuth.auth.getUser(token);
    if (uErr || !u?.user?.id) {
      return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });
    }

    const callerAuthId = u.user.id;

    // ===== invoiceId =====
    const url = new URL(req.url);
    const invoiceId = (url.searchParams.get("invoiceId") || "").trim();

    if (!invoiceId) {
      return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });
    }

    // ===== Worker caller =====
    const { data: callerWorker } = await supabaseAdmin
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", callerAuthId)
      .maybeSingle();

    if (!callerWorker || !callerWorker.is_active) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const isAdmin = callerWorker.role === "admin";

    // ===== Factura =====
    const { data: inv } = await supabaseAdmin
      .from("worker_invoices")
      .select("id,worker_id,month_date,status,total_eur,worker_note,admin_note,locked_at")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!inv) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    if (!isAdmin && inv.worker_id !== callerWorker.id) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

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

    // ===== PDF SIN FUENTES AFM =====
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      autoFirstPage: true,
      bufferPages: true
    });

    // ⚠️ Esto es lo clave:
    // Evita que PDFKit intente cargar Helvetica.afm
    (doc as any)._font = null;

    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));

    const done = new Promise<Buffer>((resolve) =>
      doc.on("end", () => resolve(Buffer.concat(chunks)))
    );

    doc.text("Factura de trabajador");
    doc.moveDown();

    doc.text(`Trabajador: ${workerName}`);
    doc.text(`Mes: ${monthLabel(inv.month_date)}`);
    doc.text(`Estado: ${String(inv.status || "").toUpperCase()}`);
    doc.moveDown();

    doc.text(`Total: ${euro(inv.total_eur)}`);
    doc.moveDown();

    doc.text("Detalle:");
    doc.moveDown(0.5);

    for (const ln of lines || []) {
      doc.text(`${ln.label} — ${euro(ln.amount_eur)}`);
    }

    if (inv.worker_note) {
      doc.moveDown();
      doc.text(`Nota trabajador: ${inv.worker_note}`);
    }

    if (inv.admin_note) {
      doc.moveDown();
      doc.text(`Nota admin: ${inv.admin_note}`);
    }

    doc.end();

    const pdf = await done;
    const bytes = new Uint8Array(pdf);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura.pdf"`,
        "Cache-Control": "no-store"
      }
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
