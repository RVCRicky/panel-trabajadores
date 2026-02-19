import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const supabaseAdmin = createClient(
  getEnv("SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: { persistSession: false },
  }
);

type Body = {
  workerId: string;           // UUID del usuario (auth.users.id) = worker_profiles.id en tu diseño típico
  email?: string | null;
  password?: string | null;
  // opcional: campos de tu tabla
  name?: string | null;
  role?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (!body.workerId) {
      return NextResponse.json({ ok: false, error: "Missing workerId" }, { status: 400 });
    }

    // 1) Actualizar AUTH (email/password)
    if (body.email || body.password) {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
        body.workerId,
        {
          ...(body.email ? { email: body.email } : {}),
          ...(body.password ? { password: body.password } : {}),
        }
      );

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
      }

      // 2) Opcional: marcar email confirmado si cambias email (evita líos al loguear)
      // En algunos proyectos esto no hace falta, pero ayuda.
      if (body.email) {
        await supabaseAdmin.auth.admin.updateUserById(body.workerId, {
          email_confirm: true as any, // supabase-js lo soporta en muchos entornos; si te diera error lo quitamos
        } as any);
      }
    }

    // 3) Opcional: actualizar tu tabla worker_profiles
    // (solo si tu tabla tiene columnas "name" y "role")
    if (body.name !== undefined || body.role !== undefined) {
      const update: any = {};
      if (body.name !== undefined) update.name = body.name;
      if (body.role !== undefined) update.role = body.role;

      const { error: e2 } = await supabaseAdmin
        .from("worker_profiles")
        .update(update)
        .eq("id", body.workerId);

      if (e2) {
        return NextResponse.json({ ok: false, error: e2.message }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}
