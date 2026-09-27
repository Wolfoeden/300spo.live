"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { LINKS } from "@/lib/site";
import { formatInteger, formatPercent } from "@/lib/format";
import { useLiveData } from "./data/live-data";
import { ArrowRight } from "./icons";
import { Reveal } from "./motion";
import { DelegateButton } from "./wallet/delegation";

const CYCLE_MS = 7000;
const REWARDS = [170, 170, 340, 170, 170, 340];
const FALLBACK_HEIGHT = 13_990_000;

type Stage = "confirmed" | "latest" | "incoming";

export function BlockArrivals() {
  const { metrics } = useLiveData();
  const pool = metrics?.pool;

  return (
    <section id="pool" aria-labelledby="blocks-title" className="relative overflow-hidden border-y border-line bg-night py-24 sm:py-32">
      <div aria-hidden="true" className="grid-backdrop absolute inset-0 opacity-60" />
      <div className="container-site relative">
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="kicker">300 live infrastructure</p>
            <h2 id="blocks-title" className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
              Live block arrivals
            </h2>
            <p className="mt-4 text-muted">
              Follow the chain from newer incoming blocks to confirmed history. The block height is synchronized with current Cardano chain data.
            </p>
          </div>
          <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-muted">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-positive" /> Live chain height
          </span>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Reveal className="glass overflow-hidden rounded-3xl p-5 sm:p-8">
            <BlockRail tipHeight={metrics?.chain?.blockHeight ?? null} />
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
              {[
                ["Network", "Block rewards + fees"],
                ["Pool", "Fixed cost + margin"],
                ["Delegators", "Protocol rewards"],
              ].map(([label, text], index) => (
                <FlowStep key={label} label={label} text={text} last={index === 2} />
              ))}
            </div>
            <p className="mt-6 text-xs leading-relaxed text-faint">
              The +170 ADA and +340 ADA animations illustrate recent 300 pool block-reward ranges. Actual protocol rewards vary and are not guaranteed.
            </p>
          </Reveal>

          <Reveal delay={0.1} className="flex flex-col gap-3">
            {[
              ["Blocks produced", formatInteger(pool?.blockCount)],
              ["Saturation", formatPercent(pool?.liveSaturation)],
              ["Delegators", formatInteger(pool?.liveDelegators)],
            ].map(([label, value]) => (
              <div key={label} className="glass rounded-2xl p-5">
                <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">{label}</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{value}</p>
              </div>
            ))}
            <DelegateButton target="pool" className="btn btn-gold mt-auto">
              Delegate to 300 SPO <ArrowRight size={16} />
            </DelegateButton>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function FlowStep({ label, text, last }: { label: string; text: string; last: boolean }) {
  return (
    <>
      <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-gold">{label}</p>
        <p className="mt-1 text-sm font-medium">{text}</p>
      </div>
      {!last && <ArrowRight size={18} className="mx-auto rotate-90 text-faint sm:rotate-0" />}
    </>
  );
}

function BlockRail({ tipHeight }: { tipHeight: number | null }) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [syncedTip, setSyncedTip] = useState(tipHeight);
  // A fresh chain tip restarts the illustrated sequence at the real height.
  if (tipHeight !== syncedTip) {
    setSyncedTip(tipHeight);
    setTick(0);
  }
  const height = Math.floor(tipHeight && Number.isFinite(tipHeight) ? tipHeight : FALLBACK_HEIGHT) + tick;

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [reduce]);

  const blocks: { height: number; stage: Stage }[] = [
    { height: height - 2, stage: "confirmed" },
    { height: height - 1, stage: "confirmed" },
    { height, stage: "latest" },
    { height: height + 1, stage: "incoming" },
  ];

  return (
    <div>
      <div className="flex justify-between font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">
        <span>← Older blocks</span>
        <span className="hidden sm:inline">Chain order</span>
        <span>Newer blocks →</span>
      </div>
      <div className="relative mt-6">
        <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
        <ul className="relative grid grid-cols-4 gap-2 sm:gap-4" aria-label="Cardano blocks moving from right to left">
          <AnimatePresence mode="popLayout" initial={false}>
            {blocks.map((block) => (
              <motion.li
                key={block.height}
                layout
                initial={{ opacity: 0, x: 60, scale: 0.9 }}
                animate={{ opacity: block.stage === "incoming" ? 0.55 : 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -60, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                className="flex flex-col items-center"
              >
                <BlockCube block={block} reward={REWARDS[tick % REWARDS.length]} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
      <CycleBar key={tick} paused={Boolean(reduce)} />
    </div>
  );
}

function BlockCube({ block, reward }: { block: { height: number; stage: Stage }; reward: number }) {
  const latest = block.stage === "latest";
  return (
    <>
      <span className="font-mono text-[0.62rem] text-faint sm:text-xs">#{formatInteger(block.height)}</span>
      <div className="relative mt-3">
        <div
          className={`grid size-14 place-items-center rounded-2xl border text-sm font-bold sm:size-20 sm:text-lg ${
            latest
              ? "border-gold-bright/70 bg-gradient-to-br from-gold-bright to-gold-deep text-ink shadow-[0_20px_60px_-15px_rgba(233,180,76,0.8)]"
              : block.stage === "incoming"
                ? "border-dashed border-line-strong bg-white/[0.02] text-faint"
                : "border-gold/30 bg-gradient-to-br from-gold/25 to-gold-deep/10 text-gold"
          }`}
        >
          300
        </div>
        <AnimatePresence>
          {latest && (
            <motion.span
              key={block.height}
              className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-positive/15 px-2 py-0.5 font-mono text-[0.65rem] font-semibold text-positive sm:text-xs"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: [0, 1, 1, 0], y: [8, 0, -4, -10] }}
              transition={{ duration: 3, delay: 0.6, times: [0, 0.15, 0.8, 1] }}
            >
              +{reward} ADA
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <span className={`mt-3 text-[0.65rem] sm:text-xs ${latest ? "text-gold" : "text-faint"}`}>
        {block.stage === "confirmed" ? "✓ Confirmed" : latest ? "● Latest arrival" : "→ Incoming"}
      </span>
    </>
  );
}

function CycleBar({ paused }: { paused: boolean }) {
  return (
    <div className="mt-8 flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-gold-deep to-gold-bright"
          initial={{ width: paused ? "100%" : "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: paused ? 0 : CYCLE_MS / 1000, ease: "linear" }}
        />
      </div>
      <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-faint">Illustrated cycle · 7 s</span>
    </div>
  );
}
