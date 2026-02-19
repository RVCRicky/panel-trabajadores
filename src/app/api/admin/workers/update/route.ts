import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const SUPABASE_URL = getEnv("SUPABASE_URL");
const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

// Admin client (service role)
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// “User client” para leer sesión desde cookies (usa anon key)
const supabaseUser = createClient(
  SUPABASE_URL,
  getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  { auth: { persistSession: false } }
);

type Body = {
  workerId: string;
  email?: string | null;
  password?: string | null;
  name?: string | null;
  role?: string | null;
};

async function requireAdmin() {
  // Extraer access token de cookies (Supabase guarda varias cookies; esto funciona en muchos setups,
  // si en el tuyo no, lo ajustamos a tu cookie exacta)
  const cookieStore = await cookies();
  const token =
    cookieStore.get("sb-access-token")?.value ||
    cookieStore.get("supabase-auth-token")?.value;

  if (!token) return { ok: false, error: "Not authenticated" as const };

  const { data: userData, error: userErr } = await supabaseUser.auth.getUser(token);
  if (userErr || !userData?.user?.id) return { ok: false, error: "Invalid session" as const };

  const callerId = userData.user.id;

  // Miramos el perfil del que llama
  const { data: profile, error: pErr } = await supabaseAdmin
    .from("worker_profiles")
    .select("role")
    .eq("id", callerId)
    .maybeSingle();

  if (pErr) return { ok: false, error: pErr.message as const };
  if (!profile) return { ok: false, error: "No profile" as const };

  // AJUSTA AQUÍ el rol admin si usas otro nombre
  if (profile.role !== "admin") return { ok: false, error: "Forbidden" as const };

  return { ok: true, callerId };
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 401 });

    const body = (await req.json()) as Body;
    if (!body.workerId) {
      return NextResponse.json({ ok: false, error: "Missing workerId" }, { status: 400 });
    }

    // AUTH update
    if (body.email || body.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(body.workerId, {
        ...(body.email ? { email: body.email } : {}),
        ...(body.password ? { password: body.password } : {}),
      });

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

      // Confirm email (opcional)
      if (body.email) {
        await supabaseAdmin.auth.admin.updateUserById(body.workerId, {
          email_confirm: true as any,
        } as any);
      }
    }

    // worker_profiles update (opcional)
    if (body.name !== undefined || body.role !== undefined) {
      const update: any = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.role !== undefined) update.role = body.role;

      const { error: e2 } = await supabaseAdmin
        .from("worker_profiles")
        .update(update)
        .eq("id", body.workerId);

      if (e2) return NextResponse.json({ ok: false, error: e2.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
