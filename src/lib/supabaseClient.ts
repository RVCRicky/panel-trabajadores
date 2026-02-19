// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ✅ Storage “safe” (Safari / private mode / restricciones)
function makeSafeStorage() {
  // memoria fallback
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

const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window === "undefined" ? undefined : makeSafeStorage(),
  },
});
