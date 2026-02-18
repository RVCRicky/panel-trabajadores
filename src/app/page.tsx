"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function Home() {
  const router = useRouter();
  const [msg, setMsg] = useState("Cargando…");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setMsg("Entrando al panel…");
        router.replace("/panel");
      } else {
        setMsg("Redirigiendo a login…");
        router.replace("/login");
      }
    })();
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, color: "#666" }}>
      {msg}
    </div>
  );
}
