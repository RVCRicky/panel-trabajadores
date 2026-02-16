import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseCSV(text: string) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const headers = lines[0].split(",").map(h => h.trim());

  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const row: any = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] || "").trim();
    });
    return row;
  });
}

export async function POST(req: Request) {
  try {
    const { csvUrl } = await req.json();

    if (!csvUrl) {
      return NextResponse.json({ ok: false, error: "MISSING_CSV_URL" }, { status: 400 });
    }

    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Descargar CSV
    const r = await fetch(csvUrl);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: "CSV_FETCH_FAILED" }, { status: 400 });
    }

    const text = await r.text();
    const rows = parseCSV(text);

    // Limpiar tabla
    await adminClient.from("attendance_rows").delete().neq("id", 0);

    let inserted = 0;

    for (const row of rows) {
      const externalRef = row["ExternalRef"] || row["external_ref"] || row["CodigoRef"];
      const codigo = (row["Codigo"] || "").toLowerCase();
      const captado = (row["Captado"] || "").toLowerCase() === "true";
      const minutes = parseInt(row["Minutes"] || "0");
      const calls = parseInt(row["Calls"] || "0");

      if (!externalRef) continue;

      const { data: worker } = await adminClient
        .from("workers")
        .select("id")
        .eq("external_ref", externalRef)
        .maybeSingle();

      if (!worker) continue;

      await adminClient.from("attendance_rows").insert({
        worker_id: worker.id,
        minutes,
        calls,
        codigo,
        captado,
        raw: row
      });

      inserted++;
    }

    return NextResponse.json({ ok: true, inserted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
