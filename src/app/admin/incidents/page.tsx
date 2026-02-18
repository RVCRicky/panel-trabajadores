"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Incident = {
  id: string;
  incident_date?: string | null;
  month_date?: string | null;
  kind?: string | null; // en tu tabla era NOT NULL, pero por seguridad lo dejamos optional en UI
  incident_type?: string | null;
  status?: string | null;
  minutes_late?: number | null;
  penalty_eur?: number | null;
  notes?: string | null;

  worker_id?: string | null;
  worker_name?: string | null;
  name?: string | null;
  display_name?: string | null;
};

function badgeStatus(st: string) {
  const base: any = {
    display: "
