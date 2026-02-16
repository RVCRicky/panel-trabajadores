import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) {
      return NextResponse.json({ ok: false, error: "NO_TOKEN" }, { status: 401 });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await userClient.auth.getUser();
    const uid = u?.user?.id || null;
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NOT_AUTH" }, { status: 401 });
    }

    const db = createClient(supabaseUrl, serviceKey);

    // comprobar admin
    const { data: adminRow } = await db
      .from("app_admins")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();

    if (!adminRow) {
      return NextResponse.json({ ok: false, error: "NOT_ADMIN" }, { status: 403 });
    }

    const form = await req.formData();

    const worker_id = form.get("worker_id")?.toString();
    const month_date = form.get("month_date")?.toString();
    const file = form.get("file") as File;

    if (!worker_id || !month_date || !file) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const fileName = `${month_date}/${worker_id}-${Date.now()}.pdf`;

    const { error: uploadError } = await db.storage
      .from("invoices")
      .upload(fileName, file, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
    }

    const { error: insertError } = await db.from("invoices").insert({
      worker_id,
      month_date,
      file_path: fileName,
      status: "pending",
    });

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
