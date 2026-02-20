"use client";

import { useEffect, useState } from "react";

function fmtMin(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}m`;
}

export default function AdminHoursPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [month, setMonth] = useState("2026-02-01");

  async function load() {
    const res = await fetch(`/api/admin/hours?month=${month}`);
    const j = await res.json();
    if (j.ok) setRows(j.rows || []);
  }

  useEffect(() => {
    load();
  }, [month]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Horas del Mes</h1>

      <input
        type="date"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />

      <table style={{ width: "100%", marginTop: 20 }}>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Rol</th>
            <th>Productivo</th>
            <th>Online</th>
            <th>Pausa</th>
            <th>Baño</th>
            <th>Esperado</th>
            <th>Diferencia</th>
            <th>Penalizaciones €</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.worker_id}>
              <td>{r.name}</td>
              <td>{r.role}</td>
              <td>{fmtMin(r.productive_minutes)}</td>
              <td>{fmtMin(r.online_minutes)}</td>
              <td>{fmtMin(r.pause_minutes)}</td>
              <td>{fmtMin(r.bathroom_minutes)}</td>
              <td>{fmtMin(r.expected_minutes)}</td>
              <td style={{ color: r.diff_minutes < 0 ? "red" : "green" }}>
                {fmtMin(r.diff_minutes)}
              </td>
              <td>{r.penalties_eur} €</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
