// src/app/admin/layout.tsx
import type { Metadata, Viewport } from "next";
import AdminShell from "./AdminShell";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Tarot Celestial · Admin",
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
