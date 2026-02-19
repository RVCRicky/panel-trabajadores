import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: Request) {
  try {
    const CRON_SECRET = getEnv("CRON_SECRET");

    const url = new URL(req.url);
    const got = url.searchParams.get("secret") || "";

    if (got !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    // Llamamos al sync existente, pero con un header secreto (sin sesión)
    const origin =
      req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
        ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
        : url.origin;

    const r = await fetch(`${origin}/api/admin/sync-csv`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": CRON_SECRET,
      },
      body: JSON.stringify({}), // el sync cogerá SYNC_CSV_URL por env (lo ajustamos en el paso 1.B)
    });

    const raw = await r.text();
    let j: any = null;
    try {
      j = raw ? JSON.parse(raw) : null;
    } catch {
      j = null;
    }

    if (!r.ok || !j?.ok) {
      return NextResponse.json(
        { ok: false, error: j?.error || raw || `Sync failed HTTP ${r.status}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, ...j });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
