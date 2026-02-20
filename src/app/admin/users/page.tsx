"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardHint, CardTitle, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

type WorkerRow = {
  id: string;
  user_id: string | null;
  display_name: string | null;
  role: string | null;
  is_active?: boolean | null;
};

function normRole(r: any) {
  return String(r || "").trim().toLowerCase();
}

export default function AdminUsersPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [me, setMe] = useState<WorkerRow | null>(null);

  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [q, setQ] = useState("");

  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(() => workers.find((w) => w.id === selectedId) || null, [workers, selectedId]);

  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [showPass, setShowPass] = useState(false);

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function loadMeAndWorkers() {
    setErr(null);
    setOkMsg(null);
    setLoadingList(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      // 1) comprobar que soy admin (vía /api/dashboard/full que ya valida worker)
      const res = await fetch("/api/dashboard/full", { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => null);
      if (!j?.ok) return setErr(j?.error || "No se pudo cargar el perfil.");

      const myWorker = j?.user?.worker as WorkerRow;
      setMe(myWorker);

      if (normRole(myWorker?.role) !== "admin") {
        setErr("No autorizado. Esta pantalla es solo para admin.");
        return;
      }

      // 2) listar workers (por simplicidad, lo hacemos desde el cliente con anon session)
      //    Si tu RLS bloquea esto, dímelo y lo movemos a un endpoint /api/admin/workers.
      const { data: rows, error } = await supabase
        .from("workers")
        .select("id, user_id, display_name, role, is_active")
        .order("role", { ascending: true })
        .order("display_name", { ascending: true })
        .limit(2000);

      if (error) return setErr(error.message);

      setWorkers((rows || []) as any);
    } catch (e: any) {
      setErr(e?.message || "Error cargando usuarios");
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    loadMeAndWorkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cuando seleccionas uno, limpiamos campos
  useEffect(() => {
    setErr(null);
    setOkMsg(null);
    setEmail("");
    setPass("");
    setPass2("");
    setShowPass(false);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return workers;
    return workers.filter((w) => {
      const name = String(w.display_name || "").toLowerCase();
      const role = String(w.role || "").toLowerCase();
      const uid = String(w.user_id || "").toLowerCase();
      return name.includes(t) || role.includes(t) || uid.includes(t);
    });
  }, [workers, q]);

  async function updateCreds() {
    setErr(null);
    setOkMsg(null);

    if (!selected) return setErr("Selecciona un usuario primero.");
    if (!selected.user_id) return setErr("Este trabajador no tiene Auth UID (user_id) asignado.");

    const nextEmail = email.trim();
    const nextPass = pass.trim();
    const nextPass2 = pass2.trim();

    if (!nextEmail && !nextPass) return setErr("Rellena email y/o contraseña.");
    if (nextPass && nextPass.length < 6) return setErr("La contraseña debe tener al menos 6 caracteres.");
    if (nextPass && nextPass !== nextPass2) return setErr("Las contraseñas no coinciden.");

    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return router.replace("/login");

      const res = await fetch("/api/admin/auth/update-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          uid: selected.user_id,
          email: nextEmail || "",
          password: nextPass || "",
        }),
      });

      const j = await res.json().catch(() => null);
      if (!j?.ok) {
        setErr(j?.error || "Error actualizando credenciales");
        return;
      }

      setOkMsg(`Actualizado ✅ (${selected.display_name || "usuario"})`);
      setEmail("");
      setPass("");
      setPass2("");
      setShowPass(false);
    } catch (e: any) {
      setErr(e?.message || "Error actualizando credenciales");
    } finally {
      setLoading(false);
    }
  }

  const roleTone = (r: any) => {
    const x = normRole(r);
    if (x === "admin") return "ok";
    if (x === "central") return "warn";
    if (x === "tarotista") return "neutral";
    return "neutral";
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Admin · Usuarios</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <button
            onClick={loadMeAndWorkers}
            disabled={loadingList}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #111", fontWeight: 900 }}
          >
            {loadingList ? "Cargando..." : "Refrescar"}
          </button>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
            style={{ padding: 10, borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 900 }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {me ? (
        <Card>
          <CardTitle>Mi sesión</CardTitle>
          <CardHint>
            Usuario: <b>{me.display_name || "—"}</b> · Rol: <Badge tone={roleTone(me.role) as any}>{String(me.role || "—")}</Badge>
          </CardHint>
        </Card>
      ) : null}

      {err ? <div style={{ padding: 10, border: "1px solid #ffcccc", background: "#fff3f3", borderRadius: 12 }}>{err}</div> : null}
      {okMsg ? <div style={{ padding: 10, border: "1px solid #ccffdd", background: "#f2fff7", borderRadius: 12 }}>{okMsg}</div> : null}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 14, alignItems: "start" }}>
        {/* LISTA */}
        <Card>
          <CardTitle>Trabajadores</CardTitle>
          <CardHint>Busca por nombre, rol o UID.</CardHint>

          <div style={{ marginTop: 10 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
            />
          </div>

          <div style={{ marginTop: 10, maxHeight: 520, overflow: "auto", border: "1px solid #eee", borderRadius: 12 }}>
            {filtered.map((w) => {
              const isSel = w.id === selectedId;
              return (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 10,
                    border: "none",
                    borderBottom: "1px solid #f2f2f2",
                    background: isSel ? "#eef6ff" : "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 1000 }}>{w.display_name || "—"}</div>
                    <Badge tone={roleTone(w.role) as any}>{String(w.role || "—")}</Badge>
                  </div>
                  <div style={{ color: "#666", marginTop: 4, fontSize: 12 }}>
                    UID: <b>{w.user_id ? String(w.user_id).slice(0, 8) + "…" : "—"}</b> · Activo:{" "}
                    <b>{w.is_active === false ? "NO" : "SÍ"}</b>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 ? <div style={{ padding: 10, color: "#666" }}>Sin resultados.</div> : null}
          </div>
        </Card>

        {/* EDITOR */}
        <Card>
          <CardTitle>Cambiar email / contraseña</CardTitle>
          <CardHint>
            {selected ? (
              <>
                Seleccionado: <b>{selected.display_name || "—"}</b> · UID: <b>{selected.user_id || "—"}</b>
              </>
            ) : (
              "Selecciona un trabajador a la izquierda."
            )}
          </CardHint>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900 }}>Auth UID (user_id)</span>
              <input
                value={selected?.user_id || ""}
                readOnly
                placeholder="—"
                style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd", background: "#fafafa" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900 }}>Nuevo email (opcional)</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ej: carmelina@tc.local"
                disabled={!selected}
                style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900 }}>Nueva contraseña (opcional)</span>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                  placeholder="••••••••"
                  type={showPass ? "text" : "password"}
                  disabled={!selected}
                  style={{ flex: 1, padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  disabled={!selected}
                  style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd", fontWeight: 900 }}
                >
                  {showPass ? "Ocultar" : "Mostrar"}
                </button>
              </div>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 900 }}>Repetir contraseña</span>
              <input
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
                placeholder="••••••••"
                type={showPass ? "text" : "password"}
                disabled={!selected}
                style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
              />
            </label>

            <button
              onClick={updateCreds}
              disabled={loading || !selected}
              style={{
                marginTop: 4,
                padding: 12,
                borderRadius: 14,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 1000,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Actualizando..." : "Actualizar credenciales"}
            </button>

            <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
              Nota: esto actualiza Auth (email/contraseña). Si tu worker no tiene UID, primero hay que crearlo en Authentication.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
