"use client";

import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { cosmetic } from "@/lib/game/catalog";

const BURST_MS = 3200;
const COINS = 18;

/** Full-stage celebration for a win: gold flash, shock ring, 300 coins flying out and the amount. */
export function WinBurst({ amount, onDone }: { amount: number; onDone(): void }) {
  const reduce = useReducedMotion();
  const [seed] = useState(() => Math.floor(Math.random() * 1000));

  useEffect(() => {
    const timer = window.setTimeout(onDone, BURST_MS);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-30 grid place-items-center overflow-hidden rounded-2xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      aria-live="assertive"
    >
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(233,180,76,0.45),rgba(10,10,10,0.55)_65%)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0.8] }}
        transition={{ duration: 0.6 }}
      />
      {!reduce && (
        <>
          <motion.span
            className="absolute size-40 rounded-full border-4 border-gold-bright"
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 3.2, opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
          {Array.from({ length: COINS }, (_, index) => {
            const angle = (index / COINS) * Math.PI * 2 + cosmetic(seed, index) * 0.4;
            const distance = 110 + cosmetic(seed, index + 50) * 90;
            return (
              <motion.img
                key={index}
                src="/300-logo.jpg"
                alt=""
                className="absolute size-7 rounded-full shadow-[0_0_12px_rgba(233,180,76,0.8)] ring-1 ring-gold-bright/70"
                initial={{ x: 0, y: 0, scale: 0.3, opacity: 1, rotate: 0 }}
                animate={{
                  x: Math.cos(angle) * distance,
                  y: [0, Math.sin(angle) * distance, Math.sin(angle) * distance + 70],
                  scale: [0.3, 1.1, 0.8],
                  opacity: [1, 1, 0],
                  rotate: 540 * (index % 2 ? 1 : -1),
                }}
                transition={{ duration: 1.6, ease: "easeOut", delay: 0.05 + (index % 6) * 0.03 }}
              />
            );
          })}
        </>
      )}
      <motion.div
        className="relative text-center"
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: [0.3, 1.18, 1], opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-gold-bright">You won</p>
        <p className="mt-1 text-5xl font-bold tabular-nums tracking-tight drop-shadow-[0_4px_24px_rgba(233,180,76,0.6)] sm:text-6xl">
          <span className="text-gold-gradient">+{formatTokenAmount(BigInt(amount))}</span>
        </p>
        <p className="mt-1 text-sm font-semibold text-text">300 tokens</p>
      </motion.div>
    </motion.div>
  );
}

/** The game balance inside the arena: rolls to each new value and shows what changed. */
export function BalanceChip({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const rolling = useRef(value);
  const [previous, setPrevious] = useState(value);
  const [change, setChange] = useState<{ id: number; amount: number } | null>(null);
  if (value !== previous) {
    setPrevious(value);
    setChange({ id: (change?.id ?? 0) + 1, amount: value - previous });
  }

  useEffect(() => {
    const controls = animate(rolling.current, value, {
      duration: reduce ? 0 : 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        rolling.current = latest;
        setShown(Math.round(latest));
      },
    });
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <div className="relative shrink-0" aria-label={`Game balance ${formatTokenAmount(BigInt(value))} tokens`}>
      <div className="flex items-baseline gap-1.5 rounded-full border border-gold/30 bg-gold/[0.07] px-3 py-1.5">
        <span className="hidden text-[0.65rem] uppercase tracking-[0.14em] text-faint sm:inline">Balance</span>
        <span className="text-sm font-semibold tabular-nums">{formatTokenAmount(BigInt(shown))}</span>
        <span className="text-gold-gradient text-xs font-bold">300</span>
      </div>
      <AnimatePresence>
        {change && change.amount !== 0 && (
          <motion.span
            key={change.id}
            className={`pointer-events-none absolute right-3 top-full font-mono text-xs font-semibold tabular-nums ${change.amount > 0 ? "text-positive" : "text-danger"}`}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: [0, 1, 1, 0], y: [-6, 2, 2, 8] }}
            transition={{ duration: 1.8, times: [0, 0.15, 0.75, 1] }}
          >
            {change.amount > 0 ? "+" : "−"}
            {formatTokenAmount(BigInt(Math.abs(change.amount)))}
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {change && change.amount > 0 && (
          <motion.span
            key={`glow-${change.id}`}
            className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_24px_rgba(233,180,76,0.9)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.4 }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
