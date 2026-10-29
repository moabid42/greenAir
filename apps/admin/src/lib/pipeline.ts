"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PipelineStatus {
  mode: string;
  checked_at: string;
  observations: number | null;
  roads: number | null;
  layers: number | null;
  sources: { source_id: string; status: string; last_attempt_at: string | null; last_success_at: string | null; latest_observed_at: string | null; rows_downloaded: number }[];
  builds: { resource: string; build_id: string; status: string; built_at: string }[];
}

export function usePipeline(base: string) {
  const [data, setData] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      if (!base) throw new Error("Set the backend URL in Settings.");
      const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/data-status`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Pipeline status unavailable (${response.status}).`);
      const result = await response.json() as PipelineStatus;
      if (current === generation.current) { setData(result); setError(null); }
    } catch (e) {
      if (current === generation.current) { setData(null); setError(e instanceof Error ? e.message : "Pipeline status unavailable."); }
    }
  }, [base]);
  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    setData(null);
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    return () => { clearInterval(timer); invalidate(); };
  }, [refresh, invalidate]);
  return { data, error, refresh };
}
