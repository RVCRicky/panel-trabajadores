// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

// ✅ Storage “safe” (Safari / private mode / restricciones)
function makeSafeStorage() {
  const mem = new Map<string, string>();

  const hasLocalStorage = () => {
    try {
      if (typeof window === "undefined") return false;
      const k = "__tc_test__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  };

  const useLS = hasLocalStorage();

  return {
    getItem: (key: string) => {
      try {
        if (useLS) return window.localStorage.getItem(key);
      } catch {}
      return mem.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      try {
        if (useLS) {
          window.localStorage.setItem(key, value);
          return;
        }
      } catch {}
      mem.set(key, value);
    },
    removeItem: (key: string) => {
      try {
        if (useLS) {
          window.localStorage.removeItem(key);
          return;
        }
      } catch {}
      mem.delete(key);
    },
  };
}

// ✅ NO lanzar error en cliente: leer envs “suave”
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Si faltan, creamos un cliente “dummy” pero la app NO explota.
// Así podrás ver el panel y te mostrará errores manejables al llamar auth.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window === "undefined" ? undefined : makeSafeStorage(),
  },
});

// (opcional) si quieres aviso claro en consola sin romper la app:
if (typeof window !== "undefined") {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in this deployment.");
  }
}
