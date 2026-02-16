"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function PanelPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      if (!s) {
        router.replace("/login");
        return;
      }
      setEmail(s.user.email || "");
    });
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ padding: 18 }}>
      <h1 style={{ marginTop: 0 }}>Panel</h1>
      <p>
        Logueado como: <b>{email || "—"}</b>
      </p>

      <button
        onClick={logout}
        style={{
          padding: 10,
          borderRadius: 10,
          border: "1px solid #111",
          background: "#111",
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600
        }}
      >
        Cerrar sesión
      </button>
    </div>
  );
}
