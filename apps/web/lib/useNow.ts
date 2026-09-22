"use client";

import { useEffect, useState } from "react";
import { startPoller } from "@/lib/fetcher";

/**
 * Ticking clock shared by the cockpit page and the site header.
 * Pauses while the tab is hidden (visibility standard) and fires a
 * catch-up tick when the tab becomes visible again.
 */
export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    setNow(new Date()); // instant first tick on mount/interval change
    const stop = startPoller(() => setNow(new Date()), intervalMs);
    return stop;
  }, [intervalMs]);

  return now;
}
