"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
  DECK_SIZE,
  FINISH,
  SUIT_COLORS,
  SUIT_SYMBOLS,
  SUITS,
  TRACK_LENGTH,
  cardRank,
  cardSuit,
  positionsAfter,
  runRace,
  type RaceEvent,
} from "@/lib/game/card-race";
import { formatTokenAmount } from "@/lib/format";
import { cardArt } from "@/lib/game/card-art";
import { formatMultiplier } from "@/lib/game/catalog";

export type RacePreview = { nonce: number; serverSeedHash: string; track: number[]; odds: number[] };
export type RaceResult = { roundId: number; outcome: number; race: { track: number[]; draws: number[]; odds: number[] } };

/** Cards that stay visible after the current one before they drop off. */
const TRAIL = 5;
const DRAW_MS = 300;
const SETBACK_MS = 700;
const START_MS = 450;
const END_MS = 700;

/** When each race event plays (ms after the race starts) and how long the whole race takes. */
export const raceTimeline = (events: RaceEvent[]) => {
  let time = START_MS;
  const at = events.map((event) => (time += event.kind === "draw" ? DRAW_MS : SETBACK_MS));
  return { at, total: time + END_MS };
};

export const raceEvents = (race: RaceResult["race"]) => runRace([...race.track, ...race.draws]).events;

type Props = {
  preview: RacePreview | null;
  result: RaceResult | null;
  /** Jump straight to the finish (skip or reduced motion). */
  instant: boolean;
  picked: number | null;
  onPick(suit: number): void;
  disabled: boolean;
  /** The picked lane shows a start button while a bet can be placed. */
  canStart: boolean;
  bet: number;
  onStart(): void;
};

export function CardRaceStage({ preview, result, instant, picked, onPick, disabled, canStart, bet, onStart }: Props) {
  const reduce = useReducedMotion();
  const events = useMemo(() => (result ? raceEvents(result.race) : []), [result]);
  const [cursor, setCursor] = useState(0);
  const [round, setRound] = useState<number | null>(null);
  if ((result?.roundId ?? null) !== round) {
    setRound(result?.roundId ?? null);
    setCursor(0);
  }

  // Warm the browser cache with all 48 card images so turned cards never show up blank.
  useEffect(() => {
    for (let card = 0; card < DECK_SIZE; card += 1) new Image().src = cardArt(cardSuit(card), cardRank(card)).src;
  }, []);

  useEffect(() => {
    if (!result || instant || reduce) return;
    const { at } = raceTimeline(events);
    const timers = at.map((time, index) => window.setTimeout(() => setCursor(index + 1), time));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [result, events, instant, reduce]);

  const shown = result && (instant || reduce) ? events.length : cursor;
  const track = result?.race.track ?? preview?.track ?? null;
  const odds = result?.race.odds ?? preview?.odds ?? null;
  const positions = positionsAfter(events, shown);
  const played = events.slice(0, shown);
  const draws = played.filter((event): event is Extract<RaceEvent, { kind: "draw" }> => event.kind === "draw");
  const lastDraw = draws[draws.length - 1] ?? null;
  // The five cards turned before the current one, newest first; older ones drop off the end.
  const trail = draws.slice(-(TRAIL + 1), -1).reverse();
  const drawn = draws.length;
  const reached = played.filter((event) => event.kind === "setback").length;
  const lastEvent = played[played.length - 1];
  const finished = !!result && shown === events.length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-14 shrink-0">
          <CardBack className="absolute inset-0 translate-x-1 translate-y-1 opacity-50" />
          <CardBack className="absolute inset-0" />
        </div>
        <div className="relative z-10 h-20 w-14 shrink-0 [perspective:600px]">
          <AnimatePresence mode="popLayout">
            {lastDraw ? (
              <motion.div
                key={lastDraw.card}
                className="absolute inset-0"
                initial={{ rotateY: 180, x: -68, opacity: 0.6 }}
                animate={{ rotateY: 0, x: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
              >
                <FaceCard card={lastDraw.card} />
              </motion.div>
            ) : (
              <div className="absolute inset-0 rounded-md border border-dashed border-line" />
            )}
          </AnimatePresence>
        </div>
        <div className="-my-2 flex min-w-0 items-center overflow-hidden py-2 pr-2" aria-hidden="true">
          <AnimatePresence initial={false}>
            {trail.map((event, index) => (
              <motion.div
                key={event.card}
                layout
                className="relative -ml-5 h-14 w-10 shrink-0 first:ml-0"
                style={{ zIndex: TRAIL - index }}
                initial={{ opacity: 0, x: -28, scale: 1.15 }}
                animate={{ opacity: 1 - index * 0.17, x: 0, scale: 1 - index * 0.07, rotate: index * 3 }}
                exit={{ opacity: 0, x: 18, scale: 0.6, rotate: 12 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <FaceCard card={event.card} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <p className="min-h-4 text-xs text-muted" aria-live="polite">
        {!result
          ? ""
          : finished
            ? `${SUITS[result.outcome]} crosses the line after ${drawn} cards.`
            : lastEvent?.kind === "setback"
              ? `All aces reached card ${lastEvent.row}: ${SUITS[lastEvent.suit]} steps back.`
              : lastDraw
                ? `Card ${drawn}: ${SUITS[lastDraw.suit]} moves up`
                : "Shuffling…"}
      </p>

      <div className="grid grid-cols-[3.5rem_repeat(4,minmax(0,1fr))] gap-x-1.5 sm:gap-x-2">
        {/* Track column: finish flag on top, the seven cards below, the gate at the bottom. */}
        <div className="flex flex-col">
          <div className="grid h-10 place-items-center">
            <span className="h-3 w-full rounded-sm bg-[repeating-conic-gradient(#e9b44c_0_25%,#0b0b0c_0_50%)] bg-[length:8px_8px]" />
          </div>
          {Array.from({ length: TRACK_LENGTH }, (_, index) => TRACK_LENGTH - index).map((row) => (
            <div key={row} className="grid h-10 place-items-center">
              {track ? (
                <motion.div
                  animate={row <= reached ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className={`rounded-md ${row <= reached ? "ring-2 ring-gold/70" : ""}`}
                >
                  <FaceCard card={track[row - 1]} sideways dim={row <= reached && !(lastEvent?.kind === "setback" && lastEvent.row === row)} />
                </motion.div>
              ) : (
                <span className="h-8 w-12 rounded-md bg-white/[0.04]" />
              )}
            </div>
          ))}
          <div className="grid h-10 place-items-center font-mono text-[0.6rem] uppercase tracking-[0.14em] text-faint">Gate</div>
        </div>

        {[0, 1, 2, 3].map((suit) => {
          const position = positions[suit];
          const winner = finished && result?.outcome === suit;
          const stepBack = lastEvent?.kind === "setback" && lastEvent.suit === suit;
          const cannotWin = odds?.[suit] === 0;
          return (
            <div key={suit} className="relative flex">
              <button
                type="button"
                onClick={() => onPick(suit)}
                disabled={disabled || cannotWin}
                aria-pressed={picked === suit}
                aria-label={`Pick ${SUITS[suit]}`}
                className={`relative flex w-full flex-col rounded-xl border transition ${picked === suit ? "border-gold/70" : "enabled:hover:border-gold/30"} ${
                  finished && !winner ? "opacity-50" : ""
                }`}
                style={{
                  backgroundColor: tint(suit, picked === suit ? 0.1 : 0.04),
                  borderColor: picked === suit ? undefined : tint(suit, 0.22),
                }}
              >
                {Array.from({ length: FINISH + 1 }, (_, row) => (
                  <span key={row} className={`h-10 ${row === 0 ? "" : "border-t border-white/[0.04]"}`} />
                ))}
                <motion.div
                  className="absolute inset-x-0 bottom-0 grid h-10 place-items-center"
                  animate={{ y: -position * 40 }}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                >
                  <AceCard suit={suit} glow={winner} />
                  <AnimatePresence>
                    {stepBack && (
                      <motion.span
                        key={shown}
                        className="absolute -right-1 -top-1 rounded-full bg-danger px-1.5 font-mono text-[0.65rem] font-bold text-white"
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        −1
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </button>
              {/* Start right in the picked lane: on phones the bet button sits far below the board. */}
              <AnimatePresence>
                {picked === suit && canStart && (
                  <motion.button
                    type="button"
                    onClick={onStart}
                    aria-label={`Start the race: bet ${formatTokenAmount(BigInt(bet))} on ${SUITS[suit]}`}
                    className="absolute inset-x-0 top-[34%] z-20 mx-auto flex w-fit flex-col items-center"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: "spring", stiffness: 520, damping: 26 }}
                  >
                    <span className="relative grid size-11 place-items-center rounded-full bg-[linear-gradient(135deg,#f4d675,#9b6710)] text-[#1a1204] shadow-[0_8px_24px_-6px_rgba(233,180,76,0.9)]">
                      <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-gold/40 [animation-duration:1.6s]" />
                      <svg viewBox="0 0 24 24" className="relative ml-0.5 size-5" fill="currentColor" aria-hidden="true">
                        <path d="M7 4.5v15l13-7.5z" />
                      </svg>
                    </span>
                    <span className="mt-1 rounded-full bg-black/80 px-1.5 py-0.5 font-mono text-[0.62rem] font-semibold tabular-nums text-gold-bright">
                      {formatTokenAmount(BigInt(bet))}
                    </span>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        <span />
        {[0, 1, 2, 3].map((suit) => (
          <p
            key={suit}
            className="mt-2 whitespace-nowrap text-center font-mono text-[0.62rem] tabular-nums sm:text-xs"
            style={{ color: odds?.[suit] === 0 ? "var(--color-faint)" : SUIT_COLORS[suit] }}
          >
            {!odds ? "…" : odds[suit] === 0 ? "—" : formatMultiplier(odds[suit])}
          </p>
        ))}
      </div>
    </div>
  );
}

/** A suit colour with transparency, for borders and tints. */
const tint = (suit: number, alpha: number) => {
  const hex = SUIT_COLORS[suit];
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** A playing card: 300 DEGEN art on its suit colour, rank and suit in the corner. */
export function FaceCard({ card, sideways, dim }: { card: number; sideways?: boolean; dim?: boolean }) {
  const suit = cardSuit(card);
  const rank = cardRank(card);
  const art = cardArt(suit, rank);
  return (
    <span
      className={`relative block overflow-hidden rounded-md border bg-panel shadow-md shadow-black/40 ${sideways ? "h-8 w-12" : "size-full"} ${dim ? "opacity-40" : ""}`}
      style={{ borderColor: tint(suit, art.face ? 0.95 : 0.7) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.src} alt={art.alt} className="absolute inset-0 size-full object-cover" />
      <span
        className={`absolute left-0.5 top-0.5 flex items-center gap-0.5 rounded bg-black/80 px-1 font-semibold leading-none ${
          sideways ? "py-px text-[0.62rem]" : "py-0.5 text-xs"
        }`}
      >
        {rank}
        <span className={sideways ? "text-[0.7rem]" : "text-sm"} style={{ color: SUIT_COLORS[suit] }}>
          {SUIT_SYMBOLS[suit]}
        </span>
      </span>
    </span>
  );
}

function AceCard({ suit, glow }: { suit: number; glow: boolean }) {
  return (
    <span
      className={`relative flex h-9 w-7 flex-col items-center justify-center rounded-md border-2 shadow-lg sm:w-8 ${
        glow ? "shadow-[0_0_24px_rgba(233,180,76,0.85)]" : "shadow-black/50"
      }`}
      style={{
        borderColor: glow ? "#f3cf73" : SUIT_COLORS[suit],
        background: `linear-gradient(160deg, ${tint(suit, 0.35)}, #0f0e0c 75%)`,
      }}
    >
      <span className="absolute left-1 top-0.5 text-[0.55rem] font-bold leading-none text-gold-bright">A</span>
      <span className="text-lg leading-none" style={{ color: SUIT_COLORS[suit] }}>
        {SUIT_SYMBOLS[suit]}
      </span>
    </span>
  );
}

function CardBack({ className = "" }: { className?: string }) {
  return (
    <span className={`grid place-items-center overflow-hidden rounded-md border border-gold/50 bg-[radial-gradient(circle_at_50%_40%,#2a2210,#0b0b0c)] ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/300-logo.jpg" alt="" className="size-6 rounded-full opacity-80" />
    </span>
  );
}
