import React from "react";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const base: any = {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontWeight: 1000,
    border: "1px solid #ddd",
    fontSize: 12,
  };

  const bg =
    tone === "ok" ? "#eaffea" : tone === "warn" ? "#fff6dd" : tone === "bad" ? "#fff3f3" : "#f4f4f4";

  return <span style={{ ...base, background: bg }}>{children}</span>;
}
