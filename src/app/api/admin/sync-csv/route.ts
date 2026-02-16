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

function normalizeValue(s: string) {
  return String(s ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function detectSeparator(headerLine: string) {
  const line = headerLine || "";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

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

function normalizeDate(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
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

    const r = await fetch(csvUrl);
    if (!r.ok) return NextResponse.json({ ok: false, error: `CSV_FETCH_FAILED_${r.status}` }, { status: 400 });

    const text = await r.text();
    const parsed = parseCSV(text);
    const rows = parsed.rows;

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: maps, error: mapsErr } = await adminClient
      .from("call_mappings")
      .select("csv_tarotista, worker_id");
    if (mapsErr) return NextResponse.json({ ok: false, error: mapsErr.message }, { status: 400 });

    const mapDict = new Map<string, string>();
    for (const m of (maps as any[]) || []) {
      const k = normalizeValue(m.csv_tarotista);
      if (k) mapDict.set(k, m.worker_id);
    }

    const { data: ws, error: wsErr } = await adminClient
      .from("workers")
      .select("id, external_ref, display_name");
    if (wsErr) return NextResponse.json({ ok: false, error: wsErr.message }, { status: 400 });

    const workersByExt = new Map<string, string>();
    const workersByName = new Map<string, string>();

    for (const w of (ws as any[]) || []) {
      const kExt = normalizeValue(w.external_ref || "");
      if (kExt) workersByExt.set(kExt, w.id);

      const kName = normalizeValue(w.display_name || "");
      if (kName) workersByName.set(kName, w.id);
    }

    const del = await adminClient.from("attendance_rows").delete().neq("id", 0);
    if (del.error) return NextResponse.json({ ok: false, error: del.error.message }, { status: 400 });

    let inserted = 0;
    let skippedNoWorker = 0;
    let skippedBad = 0;
    let skippedBadDate = 0;

    let mappedByCallMappings = 0;
    let mappedByWorkersExternalRef = 0;
    let mappedByWorkersName = 0;

    let defaultedCodigoToCliente = 0;

    for (const row of rows) {
      const tarotistaRaw = String(row["TAROTISTA"] ?? "").trim();
      const tarotistaKey = normalizeValue(tarotistaRaw);

      const telefonista = String(row["TELEFONISTA"] ?? "").trim();

      const codigoRaw = String(row["CODIGO"] ?? "").trim();
      let codigo = codigoRaw.toLowerCase();

      const llamadaCall = toBool(row["LLAMADA CALL"]);
      const captado = toBool(row["CAPTADO"]);
      const minutes = timeToMinutes(row["TIEMPO"]);
      const calls = 0;

      const source_date = normalizeDate(row["FECHA"]);

      // 1) Si no hay tarotista -> ignorar (no es un dato útil)
      if (!tarotistaKey) {
        skippedBad++;
        continue;
      }

      // 2) LlamadaCall true sin código -> ignorar
      if (!codigo && llamadaCall) continue;

      // 3) Si CODIGO vacío pero hay minutos -> lo tratamos como "cliente"
      if (!codigo && minutes > 0) {
        codigo = "cliente";
        defaultedCodigoToCliente++;
      }

      // 4) Si sigue vacío -> malo
      if (!codigo) {
        skippedBad++;
        continue;
      }

      if (codigo === "llamada call") continue;

      if (!["free", "rueda", "cliente", "repite"].includes(codigo)) {
        skippedBad++;
        continue;
      }

      if (row["FECHA"] && !source_date) {
        skippedBadDate++;
        continue;
      }

      let workerId: string | null = null;

      const fromMap = mapDict.get(tarotistaKey);
      if (fromMap) {
        workerId = fromMap;
        mappedByCallMappings++;
      } else {
        const fromExt = workersByExt.get(tarotistaKey);
        if (fromExt) {
          workerId = fromExt;
          mappedByWorkersExternalRef++;
        } else {
          const fromName = workersByName.get(tarotistaKey);
          if (fromName) {
            workerId = fromName;
            mappedByWorkersName++;
          }
        }
      }

      if (!workerId) {
        skippedNoWorker++;
        continue;
      }

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
      skippedBadDate,
      totalRows: rows.length,
      stats: {
        mappedByCallMappings,
        mappedByWorkersExternalRef,
        mappedByWorkersName,
        totalMappingsLoaded: mapDict.size,
      },
      defaultedCodigoToCliente,
      debug: {
        separatorDetected: parsed.sep === "\t" ? "TAB" : parsed.sep,
        headersRaw: parsed.headersRaw,
        headersNormalized: parsed.headersNorm,
        firstRowExample: rows[0] ? rows[0] : null,
      },
      note:
        "Regla nueva: CODIGO vacío + TIEMPO>0 => cliente. Las filas con TAROTISTA vacío se consideran basura y se saltan.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
