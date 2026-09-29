"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type LiveMetrics = {
  pool: {
    liveStakeLovelace: string | null;
    liveDelegators: number | null;
    liveSaturation: number | null;
    blockCount: number | null;
    status: string | null;
    margin: number | null;
    fixedCostLovelace: string | null;
    pledgeLovelace: string | null;
  } | null;
  drep: { amountLovelace: string | null; status: string | null; active: boolean | null } | null;
  chain: { blockHeight: number | null; blockTime: number | null } | null;
  updatedAt: string | null;
};

/** Texts editable in /admin/ (see netlify/functions/_shared/content-store.mjs). */
export type SiteContent = {
  heroAnnouncement: string;
  partnerKicker: string;
  partnerHeading: string;
};

export const DEFAULT_CONTENT: SiteContent = {
  heroAnnouncement: "300 SPO is now powered by Midnight and RealFi.",
  partnerKicker: "Our partners",
  partnerHeading: "300 SPO, powered by Midnight and RealFi.",
};

type LiveDataValue = { metrics: LiveMetrics | null; metricsFailed: boolean; content: SiteContent };

const LiveDataContext = createContext<LiveDataValue>({ metrics: null, metricsFailed: false, content: DEFAULT_CONTENT });

const METRICS_REFRESH_MS = 120_000;

export function LiveDataProvider({ children }: { children: React.ReactNode }) {
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [metricsFailed, setMetricsFailed] = useState(false);
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/metrics", { cache: "no-store" });
        if (!response.ok) throw new Error(`metrics ${response.status}`);
        const data = (await response.json()) as LiveMetrics;
        if (active) {
          setMetrics(data);
          setMetricsFailed(false);
        }
      } catch {
        if (active) setMetricsFailed(true);
      }
    };
    load();
    const timer = window.setInterval(load, METRICS_REFRESH_MS);

    fetch("/api/site-content", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`content ${response.status}`))))
      .then((data: Partial<SiteContent>) => {
        if (!active) return;
        const cleaned = Object.fromEntries(
          Object.entries(data).filter(([key, value]) => key in DEFAULT_CONTENT && typeof value === "string" && value.trim()),
        );
        setContent({ ...DEFAULT_CONTENT, ...cleaned });
      })
      .catch(() => {
        // Keep the built-in defaults; the admin store is optional for rendering.
      });

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return <LiveDataContext.Provider value={{ metrics, metricsFailed, content }}>{children}</LiveDataContext.Provider>;
}

export const useLiveData = () => useContext(LiveDataContext);
