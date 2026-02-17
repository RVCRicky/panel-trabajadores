// src/lib/authServer.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supaAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim();
}

export async function requireUser(req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new Error("NO_TOKEN");

  const { data, error } = await supaAdmin.auth.getUser(token);
  if (error || !data?.user) throw new Error("BAD_TOKEN");

  return { user: data.user, token };
}
