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
      <body className={`${geistSans.variable} ${geistMono.variable} tc-body`}>
        <header className="tc-header">
          <div className="tc-header-inner">
            <div className="tc-brand">
              <div style={{ position: "relative", width: 42, height: 42, flex: "0 0 auto" }}>
                <Image src="/logo.png" alt="Logo Tarot Celestial" fill style={{ objectFit: "contain" }} priority />
              </div>

              <div className="tc-brand-text">
                <div className="tc-brand-title">Tarot Celestial</div>
                <div className="tc-brand-subtitle">Panel Interno · Fichaje · Objetivos · Facturación</div>
              </div>
            </div>

            <div className="tc-month">{currentMonth}</div>
          </div>
        </header>

        <main className="tc-main">{children}</main>
      </body>
    </html>
  );
}
