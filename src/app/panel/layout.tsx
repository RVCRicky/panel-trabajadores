// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Panel Interno - Tarot Celestial",
  description: "Sistema interno de gestión de trabajadores",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const currentMonth = new Date().toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });

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
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 240 }}>
              <div style={{ position: "relative", width: 42, height: 42, flex: "0 0 auto" }}>
                <Image src="/logo.png" alt="Logo Tarot Celestial" fill style={{ objectFit: "contain" }} priority />
              </div>

              <div style={{ lineHeight: 1.2 }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Tarot Celestial</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Panel Interno · Fichaje · Objetivos · Facturación</div>
              </div>
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#6b7280",
                textTransform: "capitalize",
                marginLeft: "auto",
              }}
            >
              {currentMonth}
            </div>
          </div>
        </header>

        <main
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "20px 12px 28px",
          }}
        >
          {children}
        </main>
      </body>
    </html>
  );
}
