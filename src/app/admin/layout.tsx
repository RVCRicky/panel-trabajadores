// src/app/admin/layout.tsx
import AdminShell from "./AdminShell";

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
