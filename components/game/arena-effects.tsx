"use client";

import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { cosmetic } from "@/lib/game/catalog";
import { play } from "@/lib/sound";

const BURST_MS = 3200;
const COINS = 18;

/** Full-stage celebration for a win: gold flash, shock ring, 300 coins flying out and the amount. */
export function WinBurst({
  amount,
  onDone,
  compact = false,
  title = "You won",
  note = "300 tokens",
  duration = BURST_MS,
}: {
  amount: number;
  onDone(): void;
  compact?: boolean;
  title?: string;
  note?: string;
  /** Milliseconds until it goes (the blackjack table moves on quickly). */
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [seed] = useState(() => Math.floor(Math.random() * 1000));

  useEffect(() => {
    const timer = window.setTimeout(onDone, duration);
    return () => window.clearTimeout(timer);
  }, [onDone, duration]);

  useEffect(() => play("win"), []);

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
            className={`absolute rounded-full border-gold-bright ${compact ? "size-16 border-2" : "size-40 border-4"}`}
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 3.2, opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
          {Array.from({ length: compact ? COINS / 2 : COINS }, (_, index) => {
            const angle = (index / (compact ? COINS / 2 : COINS)) * Math.PI * 2 + cosmetic(seed, index) * 0.4;
            const distance = (compact ? 45 : 110) + cosmetic(seed, index + 50) * (compact ? 40 : 90);
            return (
              <motion.img
                key={index}
                src="/300-logo.jpg"
                alt=""
                className={`absolute rounded-full shadow-[0_0_12px_rgba(233,180,76,0.8)] ring-1 ring-gold-bright/70 ${compact ? "size-4" : "size-7"}`}
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
        <p className={`font-mono uppercase text-gold-bright ${compact ? "text-[0.55rem] tracking-[0.2em]" : "text-xs tracking-[0.35em]"}`}>{title}</p>
        <p
          className={`mt-1 font-bold tabular-nums tracking-tight drop-shadow-[0_4px_24px_rgba(233,180,76,0.6)] ${
            compact ? "text-xl sm:text-3xl" : "text-5xl sm:text-6xl"
          }`}
        >
          <span className="text-gold-gradient">+{formatTokenAmount(BigInt(amount))}</span>
        </p>
        {!compact && <p className="mt-1 text-sm font-semibold text-text">{note}</p>}
      </motion.div>
    </motion.div>
  );
}

/** The game balance in the panel: rolls to each new value and shows what changed. */
export function RollingBalance({ value }: { value: number }) {
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
    <span className="relative inline-flex items-baseline gap-1 tabular-nums" aria-label={`Game balance ${formatTokenAmount(BigInt(value))} tokens`}>
      {formatTokenAmount(BigInt(shown))} <span className="text-gold-gradient">300</span>
      <AnimatePresence>
        {change && change.amount !== 0 && (
          <motion.span
            key={change.id}
            className={`pointer-events-none absolute bottom-full right-0 font-mono text-xs font-semibold ${change.amount > 0 ? "text-positive" : "text-danger"}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: [0, 1, 1, 0], y: [6, -2, -2, -8] }}
            transition={{ duration: 1.8, times: [0, 0.15, 0.75, 1] }}
          >
            {change.amount > 0 ? "+" : "−"}
            {formatTokenAmount(BigInt(Math.abs(change.amount)))}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
