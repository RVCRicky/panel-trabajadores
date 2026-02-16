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
  return stripBOM(String(s ?? ""))
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function detectSeparator(headerLine: string) {
  const line = headerLine || "";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

// CSV parser con comillas y separador auto
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

    // exigir token del usuario
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    const body = (await req.json()) as Body;
    const csvUrl = (body.csvUrl || "").trim();
    if (!csvUrl) return NextResponse.json({ ok: false, error: "MISSING_CSV_URL" }, { status: 400 });

    // comprobar admin con ANON + token (RLS)
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

    // service role para escribir
    const adminClient = createClient(supabaseUrl, serviceKey);

    // limpiar tabla (reset import)
    const del = await adminClient.from("attendance_rows").delete().neq("id", 0);
    if (del.error) return NextResponse.json({ ok: false, error: del.error.message }, { status: 400 });

    let inserted = 0;
    let skippedNoWorker = 0;
    let skippedBad = 0;

    // stats útiles
    let mappedByCallMappings = 0;
    let mappedByWorkersExternalRef = 0;

    for (const row of rows) {
      // Claves NORMALIZADAS:
      // FECHA | TELEFONISTA | TAROTISTA | TIEMPO | CODIGO | CAPTADO | LLAMADA CALL
      const tarotistaKey = String(row["TAROTISTA"] ?? "").trim();
      const telefonista = String(row["TELEFONISTA"] ?? "").trim(); // central (lo guardamos en raw)
      const codigo = String(row["CODIGO"] ?? "").trim().toLowerCase();
      const llamadaCall = toBool(row["LLAMADA CALL"]);
      const captado = toBool(row["CAPTADO"]);
      const minutes = timeToMinutes(row["TIEMPO"]);
      const calls = 0;

      const fecha = String(row["FECHA"] ?? "").trim();
      const source_date = fecha ? fecha : null;

      // Validación mínima
      if (!tarotistaKey) {
        skippedBad++;
        continue;
      }

      // Si CODIGO vacío pero LLAMADA CALL es TRUE -> ignorar (no te interesa)
      if (!codigo && llamadaCall) {
        continue;
      }

      // Si CODIGO vacío y NO es llamada call -> fila mala
      if (!codigo && !llamadaCall) {
        skippedBad++;
        continue;
      }

      // Ignoramos código literal "llamada call" si apareciera
      if (codigo === "llamada call") {
        continue;
      }

      // Solo aceptamos estos 4
      if (!["free", "rueda", "cliente", "repite"].includes(codigo)) {
        skippedBad++;
        continue;
      }

      // 1) Intento: mapping Call### -> worker_id real
      let workerId: string | null = null;

      const { data: mapRow, error: mapErr } = await adminClient
        .from("call_mappings")
        .select("worker_id")
        .eq("csv_tarotista", tarotistaKey)
        .maybeSingle();

      if (mapErr) return NextResponse.json({ ok: false, error: mapErr.message }, { status: 400 });

      if (mapRow?.worker_id) {
        workerId = mapRow.worker_id as any;
        mappedByCallMappings++;
      } else {
        // 2) Fallback: si alguna vez TAROTISTA ya viene como external_ref real
        const { data: wRow, error: wErr } = await adminClient
          .from("workers")
          .select("id")
          .eq("external_ref", tarotistaKey)
          .maybeSingle();

        if (wErr) return NextResponse.json({ ok: false, error: wErr.message }, { status: 400 });

        if (wRow?.id) {
          workerId = wRow.id as any;
          mappedByWorkersExternalRef++;
        }
      }

      if (!workerId) {
        skippedNoWorker++;
        continue;
      }

      // Guardamos TELEFONISTA dentro de raw (luego haremos stats por central)
      const raw = { ...row, TELEFONISTA: telefonista };

      const ins = await adminClient.from("attendance_rows").insert({
        worker_id: workerId,
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

    return NextResponse.json({
      ok: true,
      inserted,
      skippedNoWorker,
      skippedBad,
      totalRows: rows.length,
      stats: {
        mappedByCallMappings,
        mappedByWorkersExternalRef,
      },
      debug: {
        separatorDetected: parsed.sep === "\t" ? "TAB" : parsed.sep,
        headersRaw: parsed.headersRaw,
        headersNormalized: parsed.headersNorm,
        firstRowExample: rows[0] ? rows[0] : null,
      },
      next:
        "Ahora crea mappings (Call111 -> África, etc.). Luego Sync y verás Insertadas subir.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
