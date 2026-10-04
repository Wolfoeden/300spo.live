"use client";

// The parts the card tables share (blackjack, poker): a clock for countdowns,
// the table's size, the countdown in the middle, chips and the cards of the
// 300 deck.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatTokenAmount } from "@/lib/format";
import { cardRank, cardSuit, type Card } from "@/lib/game/blackjack";
import { aceArt, cardArt } from "@/lib/game/card-art";
import { SUIT_COLORS, SUIT_SYMBOLS } from "@/lib/game/card-race";
import { play } from "@/lib/sound";
import { CardBack } from "./card-race-stage";

// A clock for countdowns, in quarter seconds; no time before hydration.
const subscribeClock = (callback: () => void) => {
  const id = window.setInterval(callback, 250);
  return () => window.clearInterval(id);
};
const clockNow = () => Math.floor(Date.now() / 250) * 250;
export const useClock = () => useSyncExternalStore(subscribeClock, clockNow, () => null);

/** The size of an element, kept up to date. */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * A card overlaps the one before by this share of its width (--card, set by
 * the row of cards), so the corner index (rank and suit, about half the width
 * at most) always stays free.
 */
export const OVERLAP = "-ml-[calc(var(--card)*0.42)]";

/**
 * The countdown in the middle of the table: a ring that runs down, and the last
 * three seconds one by one in big numbers.
 */
export function TableClock({ label, remaining, total, urgent, audible }: { label: string; remaining: number; total: number; urgent: boolean; audible: boolean }) {
  const seconds = Math.ceil(remaining);
  const final = remaining > 0 && seconds <= 3 ? seconds : null;
  const circumference = 2 * Math.PI * 44;
  const share = Math.max(0, Math.min(1, remaining / total));
  useEffect(() => {
    if (final !== null && audible) play("tick");
  }, [final, audible]);
  const color = urgent ? "var(--color-gold-bright)" : "var(--color-gold)";
  const growth = final === null ? 1 : [1.7, 1.35, 1][final - 1];
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`relative grid size-[clamp(3.6rem,13cqw,5.4rem)] place-items-center transition-opacity duration-200 ${final !== null ? "opacity-0" : ""}`}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
          <circle cx="50" cy="50" r="44" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - share)}
            className="transition-[stroke-dashoffset,stroke] duration-300 ease-linear"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <span className="relative font-mono text-[clamp(1.1rem,4.4cqw,1.7rem)] font-bold tabular-nums" style={{ color }}>
          {seconds}
        </span>
      </div>
      <p
        className={`max-w-[60cqw] truncate rounded-full border px-3 py-0.5 text-xs font-semibold transition-opacity @[40rem]:text-sm ${final !== null ? "opacity-0" : ""} ${
          urgent ? "border-gold bg-gold/20 text-gold-bright shadow-[0_0_24px_rgba(233,180,76,0.4)]" : "border-gold/30 bg-black/55 text-gold-bright"
        }`}
      >
        {label}
      </p>
      {/* The last three seconds, one by one, big. */}
      <AnimatePresence>
        {final !== null && (
          <motion.span
            key={final}
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 font-mono font-black tabular-nums text-[clamp(3rem,15cqw,6.5rem)] leading-none [text-shadow:0_0_30px_rgba(233,180,76,0.75),0_6px_0_rgba(0,0,0,0.6)]"
            style={{ color }}
            initial={{ opacity: 0, scale: growth * 0.4, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, scale: growth, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.5, x: "-50%", y: "-50%" }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
          >
            {final}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Chips flying from one point of the table (`from`, in % of it) to each winner,
 * a few per winner, one after another.
 */
export function Winnings({
  width,
  height,
  targets,
  from = { x: 50, y: 32 },
}: {
  width: number;
  height: number;
  targets: { id: number; x: number; y: number; chips: number }[];
  from?: { x: number; y: number };
}) {
  // One chip sound per winner, as their chips land (the targets of a round do not change).
  const winners = targets.length;
  useEffect(() => {
    const timers = Array.from({ length: winners }, (_, index) => window.setTimeout(() => play("chip"), 450 + index * 260));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [winners]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-40">
      {targets.flatMap((target, order) =>
        Array.from({ length: target.chips }, (_, index) => (
          <motion.span
            key={`${target.id}-${index}`}
            className="absolute size-[clamp(0.9rem,3.4cqw,1.5rem)] rounded-full border-2 border-dashed border-[#1a1204]/45 bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] shadow-[0_3px_8px_rgba(0,0,0,0.6)]"
            style={{ left: `${from.x}%`, top: `${from.y}%` }}
            initial={{ x: "-50%", y: "-50%", opacity: 0, scale: 0.6 }}
            animate={{
              x: [`-50%`, `calc(-50% + ${((target.x - from.x) / 100) * width + (index % 3) * 4 - 4}px)`],
              y: [`-50%`, `calc(-50% + ${((target.y - from.y) / 100) * height - index * 3}px)`],
              opacity: [0, 1, 1, 0],
              scale: [0.6, 1, 1, 0.9],
            }}
            transition={{ duration: 1.1, delay: 0.25 + order * 0.26 + index * 0.07, ease: [0.22, 1, 0.36, 1], times: [0, 0.75, 0.9, 1] }}
          />
        )),
      )}
    </div>
  );
}

/** A gold chip with the amount on it. */
export function Chip({ amount, doubled, big }: { amount: number; doubled?: boolean; big?: boolean }) {
  return (
    <span
      className={`grid place-items-center rounded-full border-2 border-dashed border-[#1a1204]/45 bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] font-mono font-bold tabular-nums text-[#1a1204] shadow-[0_3px_8px_rgba(0,0,0,0.6)] ${
        big ? "h-7 min-w-12 px-1.5 text-[0.68rem]" : "h-5 min-w-9 px-1 text-[0.55rem]"
      }`}
    >
      {formatTokenAmount(BigInt(amount))}
      {doubled ? " ×2" : ""}
    </span>
  );
}

/**
 * A card of the 300 deck with its index (rank and suit) in the corner; null is
 * face down. It flies in from where the cards come from (`x`, `y`: that point as
 * seen from the card's place) or turns over in place.
 */
export function PlayingCard({
  card,
  entry,
  reduce,
}: {
  card: Card | null;
  entry: { x: number; y: number; delay: number } | { flip: true; delay?: number };
  reduce: boolean;
}) {
  // The width comes from --card, set by the row of cards.
  const width = "w-[var(--card)]";
  const initial = reduce ? false : "flip" in entry ? { rotateY: 90, opacity: 0.4 } : { x: entry.x, y: entry.y, rotate: -24, scale: 0.7, opacity: 0 };
  const transition =
    "flip" in entry
      ? { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const, delay: entry.delay ?? 0 }
      : { type: "spring" as const, stiffness: 170, damping: 22, delay: entry.delay };
  if (card === null) {
    return (
      <motion.span className={`relative block aspect-[5/7] ${width}`} initial={initial} animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }} transition={transition}>
        <CardBack className="absolute inset-0 shadow-md shadow-black/60" />
      </motion.span>
    );
  }
  const suit = cardSuit(card);
  const rank = cardRank(card);
  const art = rank === "A" ? aceArt(suit) : cardArt(suit, rank);
  return (
    <motion.span
      className={`relative block aspect-[5/7] overflow-hidden rounded-[12%/9%] bg-[linear-gradient(145deg,#ffe7a8,#e9b44c_42%,#a8691c)] p-[5%] shadow-md shadow-black/60 ${width}`}
      initial={initial}
      animate={{ x: 0, y: 0, rotate: 0, rotateY: 0, scale: 1, opacity: 1 }}
      transition={transition}
    >
      <span className="relative block size-full overflow-hidden rounded-[9%/7%]" style={{ backgroundColor: SUIT_COLORS[suit] }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art.src} alt={`${rank}${SUIT_SYMBOLS[suit]}`} className="absolute inset-0 size-full object-cover" style={{ objectPosition: "50% 30%" }} />
        {/* The corner index stays within the part of the card the next one leaves free. */}
        <span className="absolute left-0 top-0 flex flex-col items-center rounded-br-md bg-black/80 px-[calc(var(--card)*0.03)] py-[calc(var(--card)*0.02)] leading-none">
          <span className="text-[max(0.5rem,calc(var(--card)*0.27))] font-black tracking-tighter text-gold-bright">{rank}</span>
          <span className="text-[max(0.45rem,calc(var(--card)*0.22))]" style={{ color: SUIT_COLORS[suit] }}>
            {SUIT_SYMBOLS[suit]}
          </span>
        </span>
      </span>
    </motion.span>
  );
}
