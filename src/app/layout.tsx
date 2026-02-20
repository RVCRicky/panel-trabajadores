import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Panel Interno - Tarot Celestial",
  description: "Sistema interno de gestión de trabajadores",
};

function formatMoneyEUR(value: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const currentMonth = new Date().toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });

  /**
   * ==========================
   * DASH (DEMO) — CAMBIA AQUÍ
   * ==========================
   * Sustituye estos valores por tus cálculos reales (ya me dijiste que existen).
   * Si aún no los tienes a mano, déjalo así y luego lo conectamos.
   */
  const DASH = {
    billingMonth: 12840, // facturación total del mes
    objectivePct: 74, // % cumplimiento global
    lowPerformers: 3, // nº trabajadoras por debajo del umbral
    activeToday: 9, // nº que han fichado hoy / activas hoy
    top3: [
      { name: "África", value: 3120, extra: "92% objetivo" },
      { name: "Esperanza", value: 2740, extra: "88% objetivo" },
      { name: "Selene", value: 2510, extra: "83% objetivo" },
    ],
    alerts: [
      "3 trabajadoras por debajo del 60% de objetivo",
      "Repetición bajando esta semana (-6%)",
      "2 fichajes incompletos (sin salida)",
    ],
  };

  const cardBase: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };

  const pill: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    fontSize: 12,
    color: "#374151",
  };

  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable}`}
        style={{
          margin: 0,
          background: "#f3f4f6",
          fontFamily: "var(--font-geist-sans)",
          color: "#111827",
        }}
      >
        {/* ===== HEADER CORPORATIVO ===== */}
        <header
          style={{
            width: "100%",
            background: "#ffffff",
            borderBottom: "1px solid #e5e7eb",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          <div
            style={{
              maxWidth: "1200px",
              margin: "0 auto",
              padding: "12px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            {/* Logo + Nombre */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  position: "relative",
                  width: 42,
                  height: 42,
                }}
              >
                <Image
                  src="/logo.png"
                  alt="Logo Tarot Celestial"
                  fill
                  style={{ objectFit: "contain" }}
                  priority
                />
              </div>

              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  Tarot Celestial
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Panel Interno · Fichaje · Objetivos · Facturación
                </div>
              </div>
            </div>

            {/* Estado rápido */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <span style={pill}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "#10b981",
                    display: "inline-block",
                  }}
                />
                Sistema estable
              </span>

              <span
                style={{
                  fontSize: 13,
                  color: "#6b7280",
                  textTransform: "capitalize",
                }}
              >
                {currentMonth}
              </span>
            </div>
          </div>
        </header>

        {/* ===== CONTENIDO PRINCIPAL ===== */}
        <main
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "20px 20px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* ===== DASHBOARD EJECUTIVO PRO ===== */}
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* Título + texto didáctico */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  Centro de control
                </div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  En 10 segundos sabes si el mes va bien, quién lidera y dónde
                  hay que apretar.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={pill}>📌 Objetivo: foco en repetición</span>
                <span style={pill}>🧾 Cierre de mes: preparado</span>
              </div>
            </div>

            {/* 4 KPIs */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 12,
              }}
            >
              <div style={{ ...cardBase, gridColumn: "span 3" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Facturación mes
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>
                  {formatMoneyEUR(DASH.billingMonth)}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Total acumulado del mes
                </div>
              </div>

              <div style={{ ...cardBase, gridColumn: "span 3" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Cumplimiento global
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 900,
                    marginTop: 6,
                  }}
                >
                  {DASH.objectivePct}%
                </div>

                <div style={{ marginTop: 10 }}>
                  <div
                    style={{
                      width: "100%",
                      height: 10,
                      borderRadius: 999,
                      background: "#f3f4f6",
                      border: "1px solid #e5e7eb",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.max(0, Math.min(100, DASH.objectivePct))}%`,
                        background:
                          DASH.objectivePct >= 85
                            ? "#10b981"
                            : DASH.objectivePct >= 65
                            ? "#f59e0b"
                            : "#ef4444",
                      }}
                    />
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Verde ≥85 · Amarillo 65–84 · Rojo &lt;65
                </div>
              </div>

              <div style={{ ...cardBase, gridColumn: "span 3" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Por debajo del umbral
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>
                  {DASH.lowPerformers}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Requieren seguimiento hoy
                </div>
              </div>

              <div style={{ ...cardBase, gridColumn: "span 3" }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Actividad hoy
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>
                  {DASH.activeToday}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Con fichaje / actividad registrada
                </div>
              </div>
            </div>

            {/* Top 3 + Alertas */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 12,
              }}
            >
              {/* TOP 3 */}
              <div style={{ ...cardBase, gridColumn: "span 7" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800 }}>Top 3 del mes</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      Liderazgo visible = motivación + control
                    </div>
                  </div>

                  <span style={pill}>🏆 Ranking</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {DASH.top3.map((t, idx) => (
                    <div
                      key={t.name}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "#fafafa",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 10,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background:
                              idx === 0 ? "#fef3c7" : idx === 1 ? "#e5e7eb" : "#fee2e2",
                            border: "1px solid #e5e7eb",
                            fontWeight: 900,
                          }}
                        >
                          {idx + 1}
                        </div>

                        <div>
                          <div style={{ fontWeight: 800 }}>{t.name}</div>
                          <div style={{ fontSize: 12, color: "#6b7280" }}>{t.extra}</div>
                        </div>
                      </div>

                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 900 }}>{formatMoneyEUR(t.value)}</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>Generado</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ALERTAS */}
              <div style={{ ...cardBase, gridColumn: "span 5" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800 }}>Alertas</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      Lo que necesita acción hoy
                    </div>
                  </div>
                  <span style={pill}>⚠️ Prioridades</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {DASH.alerts.map((a) => (
                    <div
                      key={a}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "flex-start",
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "#fff7ed",
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          marginTop: 4,
                          borderRadius: 999,
                          background: "#f59e0b",
                          display: "inline-block",
                          flex: "0 0 auto",
                        }}
                      />
                      <div style={{ fontSize: 13, lineHeight: 1.35 }}>{a}</div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280" }}>
                  Consejo: cuando esto baja, sube el rendimiento sin “perseguir” a nadie.
                </div>
              </div>
            </div>
          </section>

          {/* ===== TU APP EXISTENTE ===== */}
          <section>{children}</section>
        </main>
      </body>
    </html>
  );
}
