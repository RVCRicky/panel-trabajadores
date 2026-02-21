// src/components/ui/ResponsiveActions.tsx
"use client";

import React from "react";
import styles from "./ResponsiveActions.module.css";

type Props = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Contenedor para botones/acciones:
 * - Desktop: 2 columnas
 * - Móvil: 1 columna (no se corta nada)
 */
export function ResponsiveActions({ children, className }: Props) {
  return <div className={`${styles.wrap} ${className || ""}`}>{children}</div>;
}
