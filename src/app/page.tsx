"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session) {
        router.replace("/login");
        return;
      }

      const res = await fetch("/api/me", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok || !json.worker) {
        router.replace("/login");
        return;
      }

      if (json.worker.role === "admin") {
        router.replace("/admin");
      } else {
        router.replace("/panel");
      }
    })();
  }, [router]);

  return null;
}
