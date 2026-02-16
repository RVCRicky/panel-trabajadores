import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// CSV simple (sin comillas con comas dentro). Para MVP.
function parseCSV(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: any = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

type Body = { csvUrl: string };

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    // 1) Exigir token del usuario (para comprobar admin por RLS)
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = (await req.json()) as Body;
    const csvUrl = (body.csvUrl || "").trim();
    if (!csvUrl) return NextResponse.json({ ok: false, error: "MISSING_CSV_URL" }, { status: 400 });

    // 2) Verificar que el usuario es admin (via app_admins) usando ANON + token
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: me, error: meErr } = await userClient.auth.getUser();
    if (meErr || !me?.user) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const { data: adminRow, error: aErr } = await userClient
      .from("app_admins")
      .select("user_id")
      .eq("user_id", me.user.id)
      .maybeSingle();

    if (aErr) return NextResponse.json({ ok: false, error: aErr.message }, { status: 400 });
    if (!adminRow) return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    // 3) Descargar CSV
    const r = await fetch(csvUrl);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `CSV_FETCH_FAILED_${r.status}` }, { status: 400 });
    }

    const text = await r.text();
    const rows = parseCSV(text);

    // 4) Service role para escribir (server only)
    const adminClient = createClient(supabaseUrl, serviceKey);

    // 5) Limpiar tabla (reset import)
    const del = await adminClient.from("attendance_rows").delete().neq("id", 0);
    if (del.error) return NextResponse.json({ ok: false, error: del.error.message }, { status: 400 });

    // 6) Insertar filas nuevas
    let inserted = 0;
    let skippedNoWorker = 0;
    let skippedBad = 0;

    for (const row of rows) {
      // Nombres esperados en tu CSV:
      // - external_ref: ideal que exista; si no, usa "Trabajador" o "Extension" y lo guardas en external_ref en workers
      // - Codigo: free/rueda/cliente/repite
      // - Captado: true/false o 1/0
      // - Minutes / Calls (o Minutos / Llamadas)
      const ext =
        (row["external_ref"] ||
          row["ExternalRef"] ||
          row["Trabajador"] ||
          row["Extension"] ||
          row["Ext"] ||
          "").trim();

      const codigo = (row["Codigo"] || row["codigo"] || "").toLowerCase().trim();
      const captRaw = (row["Captado"] || row["captado"] || "").toString().toLowerCase().trim();
      const captado = captRaw === "true" || captRaw === "1" || captRaw === "si" || captRaw === "sí";

      const minutesStr = row["Minutes"] || row["Minutos"] || row["minutes"] || row["minutos"] || "0";
      const callsStr = row["Calls"] || row["Llamadas"] || row["calls"] || row["llamadas"] || "0";

      const minutes = Number.parseInt(String(minutesStr), 10) || 0;
      const calls = Number.parseInt(String(callsStr), 10) || 0;

      if (!ext || !codigo) {
        skippedBad++;
        continue;
      }

      if (!["free", "rueda", "cliente", "repite"].includes(codigo)) {
        skippedBad++;
        continue;
      }

      const { data: worker, error: wFindErr } = await adminClient
        .from("workers")
        .select("id")
        .eq("external_ref", ext)
        .maybeSingle();

      if (wFindErr) return NextResponse.json({ ok: false, error: wFindErr.message }, { status: 400 });
      if (!worker) {
        skippedNoWorker++;
        continue;
      }

      const ins = await adminClient.from("attendance_rows").insert({
        worker_id: worker.id,
        minutes,
        calls,
        codigo,
        captado,
        raw: row,
      });

      if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 400 });

      inserted++;
    }

    return NextResponse.json({
      ok: true,
      inserted,
      skippedNoWorker,
      skippedBad,
      totalRows: rows.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
