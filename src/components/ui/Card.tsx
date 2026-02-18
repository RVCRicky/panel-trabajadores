import React from "react";

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 14,
        background: "#fff",
        padding: 14,
      }}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 1000, fontSize: 14, marginBottom: 6 }}>{children}</div>;
}

export function CardValue({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 1100, fontSize: 26, lineHeight: 1.1 }}>{children}</div>;
}

export function CardHint({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>{children}</div>;
}
