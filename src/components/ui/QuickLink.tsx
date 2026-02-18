import React from "react";

export function QuickLink({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc?: string;
}) {
  return (
    <a
      href={href}
      style={{
        border: "1px solid #ddd",
        borderRadius: 14,
        padding: 14,
        textDecoration: "none",
        color: "#111",
        background: "#fff",
        display: "block",
      }}
    >
      <div style={{ fontWeight: 1000 }}>{title}</div>
      {desc ? <div style={{ color: "#666", marginTop: 6, fontSize: 12 }}>{desc}</div> : null}
    </a>
  );
}
