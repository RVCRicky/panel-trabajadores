"use client";

import React, { useMemo } from "react";

function fmt(n: any) {
  return (Number(n) || 0).toLocaleString("es-ES");
}

function shortDate(iso: string) {
  // "YYYY-MM-DD" -> "DD/MM"
  const s = String(iso || "");
  const p = s.split("-");
  if (p.length !== 3) return s;
  return `${p[2]}/${p[1]}`;
}

export type MiniBarPoint = {
  date: string;     // "YYYY-MM-DD"
  value: number;    // minutes
};

export function MiniBarChart({
  data,
  height = 140,
  title,
  subtitle,
}: {
  data: MiniBarPoint[];
  height?: number;
  title?: string;
  subtitle?: string;
}) {
  const rows = Array.isArray(data) ? data : [];

  const stats = useMemo(() => {
    const vals = rows.map((x) => Number(x.value) || 0);
    const max = vals.length ? Math.max(...vals) : 0;
    const sum = vals.reduce((a, b) => a + b, 0);
    const avg = vals.length ? sum / vals.length : 0;

    let peakDate = "";
    let peak = 0;
    for (const r of rows) {
      const v = Number(r.value) || 0;
      if (v > peak) {
        peak = v;
        peakDate = r.date;
      }
    }

    return { max, sum, avg, peak, peakDate, count: rows.length };
  }, [rows]);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {(title || subtitle) ? (
        <div>
          {title ? <div style={{ fontWeight: 1000 }}>{title}</div> : null}
          {subtitle ? <div style={{ color: "#666", marginTop: 2 }}>{subtitle}</div> : null}
        </div>
      ) : null}

      <div
        style={{
          height,
          border: "1px solid #eee",
          borderRadius: 14,
          padding: 12,
          background: "linear-gradient(180deg, #fff 0%, #fafafa 100%)",
          display: "grid",
          gridTemplateRows: "1fr auto",
          gap: 10,
        }}
      >
        {/* BARRAS */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, rows.length)}, minmax(0, 1fr))`,
            alignItems: "end",
            gap: 6,
            height: "100%",
          }}
        >
          {rows.length === 0 ? (
            <div style={{ color: "#666" }}>Sin datos.</div>
          ) : (
            rows.map((r) => {
              const v = Number(r.value) || 0;
              const pct = stats.max > 0 ? Math.max(0.06, v / stats.max) : 0; // mínimo visible
              const isPeak = stats.peakDate === r.date;

              return (
                <div key={r.date} style={{ display: "grid", gap: 6 }}>
                  <div
                    title={`${r.date} · ${fmt(v)}`}
                    style={{
                      height: `${pct * 100}%`,
                      borderRadius: 10,
                      border: "1px solid #111",
                      background: isPeak ? "#111" : "#fff",
                      boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                    }}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* EJE X (compacto) */}
        {rows.length > 0 ? (
          <div style={{ display: "flex", justifyContent: "space-between", color: "#666", fontSize: 12 }}>
            <span>{shortDate(rows[0].date)}</span>
            <span>{shortDate(rows[Math.floor(rows.length / 2)].date)}</span>
            <span>{shortDate(rows[rows.length - 1].date)}</span>
          </div>
        ) : null}
      </div>

      {/* STATS */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "#666" }}>
        <span>
          Días: <b style={{ color: "#111" }}>{fmt(stats.count)}</b>
        </span>
        <span>
          Total: <b style={{ color: "#111" }}>{fmt(stats.sum)}</b>
        </span>
        <span>
          Media/día: <b style={{ color: "#111" }}>{fmt(stats.avg.toFixed(0))}</b>
        </span>
        <span>
          Pico: <b style={{ color: "#111" }}>{fmt(stats.peak)}</b>
          {stats.peakDate ? <span> ({stats.peakDate})</span> : null}
        </span>
      </div>
    </div>
  );
}
