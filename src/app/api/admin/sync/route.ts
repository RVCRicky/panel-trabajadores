import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnvAny(names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env var: one of [${names.join(", ")}]`);
}

function monthFromISOorNow(s?: string | null) {
  // acepta "2026-02-01" o null -> usa mes actual UTC
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7) + "-01";
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}

function toBool(v: any): boolean {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "true" || t === "1" || t === "si" || t === "sí" || t === "yes";
}

function normalizeName(s: any) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function parseDDMMYYYY(s: string): string | null {
  const t = String(s || "").trim();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return null;
  const [dd, mm, yyyy] = t.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function parseCSV(text: string, separator: "," | ";"): string[][] {
  // CSV simple (Google Sheets) con comillas
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }

    if (!inQuotes && ch === separator) {
      cur.push(field);
      field = "";
      continue;
    }

    field += ch;
  }

  // última fila
  cur.push(field);
  rows.push(cur);

  // limpiar filas vacías
  return rows.filter((r) => r.some((x) => String(x ?? "").trim() !== ""));
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = getEnvAny(["NEXT_PUBLIC_SUPABASE_URL"]);
    const anonKey = getEnvAny(["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
    const serviceKey = getEnvAny(["SUPABASE_SERVICE_ROLE_KEY"]);
    const defaultCsvUrl = process.env.ATTENDANCE_CSV_URL || process.env.GSHEETS_CSV_URL || "";

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });

    // comprobar usuario
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: u } = await userClient.auth.getUser();
    const uid = u?.user?.id || null;
    if (!uid) return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });

    const db = createClient(supabaseUrl, serviceKey);

    // solo admin puede sync
    const { data: adminRow } = await db.from("app_admins").select("user_id").eq("user_id", uid).maybeSingle();
    if (!adminRow) return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });

    const body = await req.json().catch(() => ({} as any));
    const csvUrl: string = String(body?.csvUrl || body?.csv_url || defaultCsvUrl || "").trim();
    if (!csvUrl) return NextResponse.json({ ok: false, error: "MISSING_CSV_URL" }, { status: 400 });

    const headerRowIndex: number = Number.isFinite(body?.headerRowIndex) ? Number(body.headerRowIndex) : 9; // tu caso: fila 9
    const targetMonth = monthFromISOorNow(body?.month_date || body?.monthDate || null);

    // descargar CSV
    const res = await fetch(csvUrl, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, error: `CSV_FETCH_${res.status}` }, { status: 400 });

    const csvText = await res.text();

    // detectar separador
    const firstLine = csvText.split(/\r?\n/)[0] || "";
    const separatorDetected = (firstLine.includes(";") && !firstLine.includes(",")) ? ";" : ",";
    const rows = parseCSV(csvText, separatorDetected as any);

    if (rows.length <= headerRowIndex) {
      return NextResponse.json({
        ok: false,
        error: `HEADER_ROW_OUT_OF_RANGE (rows=${rows.length}, headerRowIndex=${headerRowIndex})`,
      }, { status: 400 });
    }

    const headersRaw = rows[headerRowIndex].map((h) => String(h ?? "").trim());
    const headersNorm = headersRaw.map((h) => String(h ?? "").trim().toUpperCase());

    // construir objetos de filas desde headerRowIndex+1
    const dataRows = rows.slice(headerRowIndex + 1);

    // workers por nombre (tarotistas) => id
    const { data: workers } = await db
      .from("workers")
      .select("id, role, display_name, external_ref")
      .in("role", ["tarotista", "central"]);

    const byName = new Map<string, any>();
    const byExternal = new Map<string, any>();
    for (const w of workers || []) {
      if (w?.display_name) byName.set(normalizeName(w.display_name), w);
      if (w?.external_ref) byExternal.set(String(w.external_ref).trim(), w);
    }

    // call mappings (si existe)
    let mappings: { from_name: string; to_worker_id: string }[] = [];
    const mapTry = await db.from("call_mappings").select("from_name,to_worker_id").limit(500);
    if (!mapTry.error && Array.isArray(mapTry.data)) mappings = mapTry.data as any[];

    const mapByFrom = new Map<string, string>();
    for (const m of mappings) mapByFrom.set(String(m.from_name || "").trim(), String(m.to_worker_id || "").trim());

    // inserción
    let inserted = 0;
    let skippedNoWorker = 0;
    let skippedBad = 0;
    let skippedBadDate = 0;
    let defaultedCodigoToCliente = 0;

    const badTop: Record<string, number> = {};
    const badExamples: any[] = [];

    // helper: leer columna por nombre normalizado
    function getCol(obj: Record<string, any>, want: string) {
      const idx = headersNorm.indexOf(want);
      if (idx === -1) return "";
      const key = headersRaw[idx] || want;
      return obj[key] ?? "";
    }

    // bulk insert (en bloques)
    const batch: any[] = [];
    const BATCH_SIZE = 250;

    async function flush() {
      if (batch.length === 0) return;
      const { error } = await db.from("attendance_rows").insert(batch);
      if (error) throw new Error(error.message);
      inserted += batch.length;
      batch.length = 0;
    }

    for (const row of dataRows) {
      const obj: Record<string, any> = {};
      for (let i = 0; i < headersRaw.length; i++) obj[headersRaw[i] || ""] = row[i] ?? "";

      const fechaRaw = getCol(obj, "FECHA");
      const fechaISO = parseDDMMYYYY(String(fechaRaw || ""));
      if (!fechaISO) {
        skippedBadDate++;
        skippedBad++;
        badTop["FECHA inválida"] = (badTop["FECHA inválida"] || 0) + 1;
        if (badExamples.length < 5) badExamples.push({ reason: "FECHA inválida", row: obj });
        continue;
      }

      const tarotistaRaw = String(getCol(obj, "TAROTISTA") || "").trim();
      const telefonoRaw = String(getCol(obj, "TELEFONISTA") || "").trim();
      const tiempoRaw = String(getCol(obj, "TIEMPO") || "").trim();
      const codigoRaw = String(getCol(obj, "CODIGO") || "").trim().toLowerCase();
      const captadoRaw = getCol(obj, "CAPTADO");

      // reglas basura
      if (!tarotistaRaw) {
        skippedBad++;
        badTop["TAROTISTA vacío"] = (badTop["TAROTISTA vacío"] || 0) + 1;
        if (badExamples.length < 8) badExamples.push({ reason: "TAROTISTA vacío", row: obj });
        continue;
      }

      const minutes = Math.max(0, parseInt(String(tiempoRaw || "0").replace(/[^\d]/g, ""), 10) || 0);

      let codigo = codigoRaw;
      if (!codigo && minutes > 0) {
        codigo = "cliente";
        defaultedCodigoToCliente++;
      }
      if (!codigo) {
        skippedBad++;
        badTop["CODIGO vacío"] = (badTop["CODIGO vacío"] || 0) + 1;
        if (badExamples.length < 8) badExamples.push({ reason: "CODIGO vacío", row: obj });
        continue;
      }

      // worker mapping:
      // 1) call_mappings (ej: Call111 -> worker_id)
      // 2) workers.external_ref exacto
      // 3) workers.display_name normalizado
      let workerId: string | null = null;

      const mapped = mapByFrom.get(tarotistaRaw);
      if (mapped) workerId = mapped;

      if (!workerId) {
        const wExt = byExternal.get(tarotistaRaw);
        if (wExt?.id) workerId = wExt.id;
      }
      if (!workerId) {
        const wName = byName.get(normalizeName(tarotistaRaw));
        if (wName?.id) workerId = wName.id;
      }

      if (!workerId) {
        skippedNoWorker++;
        continue;
      }

      // month_date viene de fecha
      const month_date = fechaISO.slice(0, 7) + "-01";

      // solo sincronizamos el mes targetMonth (evita mezclar meses)
      if (month_date !== targetMonth) continue;

      batch.push({
        worker_id: workerId,
        minutes,
        codigo,
        captado: toBool(captadoRaw),
        call_date: fechaISO,
        month_date,
        raw: obj, // guardamos fila original para debug
        telefonista: telefonoRaw || null, // si tu tabla no tiene esto, no pasa nada: Postgres lo rechazará -> por eso no lo hacemos
      });

      if (batch.length >= BATCH_SIZE) await flush();
    }

    await flush();

    // ✅ ENGANCHADO: recalcular earnings + bonos + cap
    // (no falla silenciosamente: si esto falla, devolvemos error)
    const r1 = await db.rpc("recompute_monthly_earnings", { p_month: targetMonth } as any);
    if (r1.error) throw new Error(`RECOMPUTE_EARNINGS_FAILED: ${r1.error.message}`);

    const r2 = await db.rpc("generate_monthly_bonus", { p_month: targetMonth } as any);
    if (r2.error) throw new Error(`GENERATE_BONUS_FAILED: ${r2.error.message}`);

    const r3 = await db.rpc("apply_bonus_cap", { p_month: targetMonth } as any);
    if (r3.error) throw new Error(`APPLY_CAP_FAILED: ${r3.error.message}`);

    const totalRows = dataRows.length;

    // devolver resumen
    const badTop20 = Object.entries(badTop)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([reason, count]) => ({ reason, count }));

    return NextResponse.json({
      ok: true,
      month_date: targetMonth,
      inserted,
      skippedNoWorker,
      skippedBad,
      skippedBadDate,
      defaultedCodigoToCliente,
      totalRows,
      stats: {
        totalMappingsLoaded: mappings.length,
      },
      debug: {
        separatorDetected,
        headersRaw,
        headersNormalized: headersNorm,
        firstRowExample: dataRows[0]
          ? Object.fromEntries(headersRaw.map((h, i) => [headersNorm[i] || h, dataRows[0][i] ?? ""]))
          : null,
      },
      badTop20,
      badExamples,
      recalculated: true,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "SERVER_ERROR" }, { status: 500 });
  }
}
