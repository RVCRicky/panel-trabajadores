import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function stripBOM(s: string) {
  return s.replace(/^\uFEFF/, "");
}

function normalizeKey(s: string) {
  // quita BOM, espacios, acentos y pone en MAYÚSCULAS
  return stripBOM(String(s ?? ""))
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // acentos
    .toUpperCase();
}

function detectSeparator(headerLine: string) {
  const line = headerLine || "";
  // preferimos tab > ; > ,
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

// CSV parser: comillas + separador auto (tab/;/,)
function parseCSV(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], sep: ",", headersRaw: [], headersNorm: [] };

  const sep = detectSeparator(lines[0]);

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && ch === sep) {
        out.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const headersRaw = parseLine(lines[0]).map(stripBOM);
  const headersNorm = headersRaw.map(normalizeKey);

  const rows = lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const row: any = {};
    // guardamos por clave NORMALIZADA para no depender de acentos/espacios
    headersNorm.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
    return row;
  });

  return { rows, sep, headersRaw, headersNorm };
}

function toBool(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "si" || s === "sí" || s === "yes" || s === "x";
}

function toInt(v: any, fallback = 0) {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

// TIEMPO puede venir como:
// - "120" (minutos)
// - "120.5"
// - "01:23:45" (hh:mm:ss)
// - "23:45" (mm:ss)
function timeToMinutes(v: any) {
  const s = String(v ?? "").trim();
  if (!s) return 0;

  if (s.includes(":")) {
    const parts = s.split(":").map((p) => p.trim());
    if (parts.length === 3) {
      const hh = toInt(parts[0], 0);
      const mm = toInt(parts[1], 0);
      const ss = toInt(parts[2], 0);
      return Math.round(hh * 60 + mm + ss / 60);
    }
    if (parts.length === 2) {
      const mm = toInt(parts[0], 0);
      const ss = toInt(parts[1], 0);
      return Math.round(mm + ss / 60);
    }
    return 0;
  }

  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : 0;
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

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = (await req.json()) as Body;
    const csvUrl = (body.csvUrl || "").trim();
    if (!csvUrl) return NextResponse.json({ ok: false, error: "MISSING_CSV_URL" }, { status: 400 });

    // comprobar admin
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

    // descargar CSV
    const r = await fetch(csvUrl);
    if (!r.ok) return NextResponse.json({ ok: false, error: `CSV_FETCH_FAILED_${r.status}` }, { status: 400 });

    const text = await r.text();
    const parsed = parseCSV(text);
    const rows = parsed.rows;

    const adminClient = createClient(supabaseUrl, serviceKey);

    // limpiar tabla
    const del = await adminClient.from("attendance_rows").delete().neq("id", 0);
    if (del.error) return NextResponse.json({ ok: false, error: del.error.message }, { status: 400 });

    // Claves NORMALIZADAS que esperamos:
    // FECHA | TELEFONISTA | TAROTISTA | TIEMPO | CODIGO | CAPTADO
    let inserted = 0;
    let skippedNoWorker = 0;
    let skippedBad = 0;

    for (const row of rows) {
      const tarotista = String(row["TAROTISTA"] ?? "").trim();
      const telefonista = String(row["TELEFONISTA"] ?? "").trim(); // central (guardamos en raw)
      const codigo = String(row["CODIGO"] ?? "").trim().toLowerCase();
      const captado = toBool(row["CAPTADO"]);
      const minutes = timeToMinutes(row["TIEMPO"]);

      // no usamos llamadas
      const calls = 0;

      const fecha = String(row["FECHA"] ?? "").trim();
      const source_date = fecha ? fecha : null;

      if (!tarotista || !codigo) {
        skippedBad++;
        continue;
      }

      // Ignoramos códigos que no nos interesan (ej: "llamada call")
if (codigo === "llamada call") {
  continue;
}

if (!["free", "rueda", "cliente", "repite"].includes(codigo)) {
  skippedBad++;
  continue;
}

      // worker por external_ref = TAROTISTA
      const { data: worker, error: wFindErr } = await adminClient
        .from("workers")
        .select("id")
        .eq("external_ref", tarotista)
        .maybeSingle();

      if (wFindErr) return NextResponse.json({ ok: false, error: wFindErr.message }, { status: 400 });
      if (!worker) {
        skippedNoWorker++;
        continue;
      }

      const raw = { ...row, TELEFONISTA: telefonista };

      const ins = await adminClient.from("attendance_rows").insert({
        worker_id: worker.id,
        source_date,
        minutes,
        calls,
        codigo,
        captado,
        raw,
      });

      if (ins.error) return NextResponse.json({ ok: false, error: ins.error.message }, { status: 400 });

      inserted++;
    }

    // Debug útil: qué headers ha detectado y un ejemplo de primera fila
    const example = rows[0] ? rows[0] : null;

    return NextResponse.json({
      ok: true,
      inserted,
      skippedNoWorker,
      skippedBad,
      totalRows: rows.length,
      debug: {
        separatorDetected: parsed.sep === "\t" ? "TAB" : parsed.sep,
        headersRaw: parsed.headersRaw,
        headersNormalized: parsed.headersNorm,
        firstRowExample: example,
      },
      note: "Para insertar filas: workers.external_ref debe coincidir EXACTO con el texto de TAROTISTA en tu hoja.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
