"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { aceArt, cardArt } from "@/lib/game/card-art";
import { formatMultiplier } from "@/lib/game/catalog";
import { Kbd } from "./game-frame";

export type RacePreview = { nonce: number; serverSeedHash: string; track: number[]; odds: number[] };
export type RaceDeal = { track: number[]; odds: number[] };
export type RaceResult = { roundId: number; outcome: number; race: { track: number[]; draws: number[]; odds: number[] } };

/** Cards that stay visible after the current one before they drop off. */
const TRAIL = 5;
const DRAW_MS = 300;
const SETBACK_MS = 700;
const START_MS = 450;
const END_MS = 700;
/** Row heights: both boards scale with their width, within these bounds. */
const FULL_ROW = { min: 40, max: 62, per: 8.4 };
const COMPACT_ROW = { min: 18, max: 42, per: 8.5 };

/** When each race event plays (ms after the race starts) and how long the whole race takes. */
export const raceTimeline = (events: RaceEvent[]) => {
  let time = START_MS;
  const at = events.map((event) => (time += event.kind === "draw" ? DRAW_MS : SETBACK_MS));
  return { at, total: time + END_MS };
};

export const raceEvents = (race: RaceResult["race"]) => runRace([...race.track, ...race.draws]).events;

type Props = {
  deal: RaceDeal | null;
  result: RaceResult | null;
  /** Jump straight to the finish (skip or reduced motion). */
  instant: boolean;
  picked: number | null;
  onPick(suit: number): void;
  disabled: boolean;
  /** The picked lane shows a start button while a bet can be placed (single race only). */
  canStart?: boolean;
  bet?: number;
  onStart?(): void;
  /** Small board for the 4× grid: no card carousel, rows scale with the width. */
  compact?: boolean;
};

export function CardRaceStage({ deal, result, instant, picked, onPick, disabled, canStart = false, bet = 0, onStart, compact = false }: Props) {
  const reduce = useReducedMotion();
  const events = useMemo(() => (result ? raceEvents(result.race) : []), [result]);
  const [cursor, setCursor] = useState(0);
  const [round, setRound] = useState<number | null>(null);
  if ((result?.roundId ?? null) !== round) {
    setRound(result?.roundId ?? null);
    setCursor(0);
  }

  // The board sizes its rows from its own width, so cards and aces grow with the screen.
  const board = useRef<HTMLDivElement>(null);
  const bounds = compact ? COMPACT_ROW : FULL_ROW;
  const [row, setRow] = useState(compact ? 24 : 44);
  useEffect(() => {
    if (!board.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setRow(Math.min(bounds.max, Math.max(bounds.min, Math.round(entry.contentRect.width / bounds.per)))),
    );
    observer.observe(board.current);
    return () => observer.disconnect();
  }, [bounds]);
  const tiny = row < 26;
  const deck = { width: Math.round(row * 1.36), height: Math.round(row * 1.9) };
  const trailCard = { width: Math.round(row * 1.0), height: Math.round(row * 1.4) };

  // Warm the browser cache with all card images so turned cards never show up blank.
  useEffect(() => {
    for (let card = 0; card < DECK_SIZE; card += 1) new Image().src = cardArt(cardSuit(card), cardRank(card)).src;
    for (let suit = 0; suit < 4; suit += 1) new Image().src = aceArt(suit).src;
  }, []);

  useEffect(() => {
    if (!result || instant || reduce) return;
    const { at } = raceTimeline(events);
    const timers = at.map((time, index) => window.setTimeout(() => setCursor(index + 1), time));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [result, events, instant, reduce]);

  const shown = result && (instant || reduce) ? events.length : cursor;
  const track = result?.race.track ?? deal?.track ?? null;
  const odds = result?.race.odds ?? deal?.odds ?? null;
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
    <div className={`flex h-full flex-col ${compact ? "gap-1.5" : "gap-3"}`}>
      {!compact && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative shrink-0" style={deck}>
              <CardBack className="absolute inset-0 translate-x-1 translate-y-1 opacity-50" />
              <CardBack className="absolute inset-0" />
            </div>
            <div className="relative z-10 shrink-0 [perspective:600px]" style={deck}>
              <AnimatePresence mode="popLayout">
                {lastDraw ? (
                  <motion.div
                    key={lastDraw.card}
                    className="absolute inset-0"
                    initial={{ rotateY: 180, x: -deck.width - 12, opacity: 0.6 }}
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
                    className="relative shrink-0"
                    style={{ zIndex: TRAIL - index, ...trailCard, marginLeft: index === 0 ? 0 : -trailCard.width / 2 }}
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
          <p className="min-h-5 text-sm text-muted" aria-live="polite">
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
        </>
      )}

      <div
        ref={board}
        className="grid"
        style={{ gridTemplateColumns: `${Math.round(row * (compact ? 1.3 : 1.42))}px repeat(4, minmax(0, 1fr))`, columnGap: compact ? 3 : Math.round(row / 5) }}
      >
        {/* Track column: finish flag on top, the seven cards below, the gate (or the turned card) at the bottom. */}
        <div className="flex flex-col">
          <div className="grid place-items-center" style={{ height: row }}>
            <span
              className="w-full rounded-sm bg-[repeating-conic-gradient(#e9b44c_0_25%,#0b0b0c_0_50%)]"
              style={{ height: Math.max(6, row * 0.3), backgroundSize: `${Math.max(4, row / 5)}px ${Math.max(4, row / 5)}px` }}
            />
          </div>
          {Array.from({ length: TRACK_LENGTH }, (_, index) => TRACK_LENGTH - index).map((level) => (
            <div key={level} className="grid place-items-center" style={{ height: row }}>
              {track ? (
                <motion.div
                  animate={level <= reached ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className={`rounded-md ${level <= reached ? "ring-2 ring-gold/70" : ""}`}
                >
                  {compact ? (
                    <MiniCard card={track[level - 1]} row={row} dim={level <= reached && !(lastEvent?.kind === "setback" && lastEvent.row === level)} />
                  ) : (
                    <FaceCard
                      card={track[level - 1]}
                      size={{ width: Math.round(row * 1.24), height: Math.round(row * 0.84) }}
                      dim={level <= reached && !(lastEvent?.kind === "setback" && lastEvent.row === level)}
                    />
                  )}
                </motion.div>
              ) : (
                <span className="rounded-md bg-white/[0.04]" style={{ height: row * 0.8, width: row * 1.2 }} />
              )}
            </div>
          ))}
          <div className="grid place-items-center" style={{ height: row }}>
            {compact && lastDraw ? (
              <motion.div key={lastDraw.card} initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.18 }}>
                <MiniCard card={lastDraw.card} row={row} upright />
              </motion.div>
            ) : (
              <span className="font-mono uppercase tracking-[0.14em] text-faint" style={{ fontSize: Math.max(8, row * 0.24) }}>
                Gate
              </span>
            )}
          </div>
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
                className={`relative flex w-full flex-col border transition ${compact ? "rounded-lg" : "rounded-xl"} ${
                  picked === suit ? "border-gold/80" : "enabled:hover:border-gold/30"
                } ${finished && !winner ? "opacity-50" : ""}`}
                style={{
                  backgroundColor: tint(suit, picked === suit ? 0.14 : 0.04),
                  borderColor: picked === suit ? undefined : tint(suit, 0.22),
                  boxShadow: picked === suit && compact ? "0 0 0 1px rgba(243, 207, 115, 0.5)" : undefined,
                }}
              >
                {Array.from({ length: FINISH + 1 }, (_, level) => (
                  <span key={level} className={level === 0 ? "" : "border-t border-white/[0.04]"} style={{ height: row }} />
                ))}
                <motion.div
                  className="absolute inset-x-0 bottom-0 grid place-items-center"
                  style={{ height: row }}
                  animate={{ y: -position * row }}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                >
                  {tiny ? <AceChip suit={suit} row={row} glow={winner} /> : <AceCard suit={suit} glow={winner} row={row} />}
                  <AnimatePresence>
                    {stepBack && (
                      <motion.span
                        key={shown}
                        className="absolute -right-1 -top-1 rounded-full bg-danger px-1 font-mono font-bold text-white"
                        style={{ fontSize: Math.max(8, row * 0.26) }}
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
                {picked === suit && canStart && onStart && (
                  <motion.button
                    type="button"
                    onClick={onStart}
                    aria-label={`Start the race: bet ${formatTokenAmount(BigInt(bet))} on ${SUITS[suit]}`}
                    className="absolute inset-x-0 top-[34%] z-20 mx-auto flex w-fit flex-col items-center gap-1"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: "spring", stiffness: 520, damping: 26 }}
                  >
                    <span
                      className="relative grid place-items-center rounded-full bg-[linear-gradient(135deg,#f4d675,#9b6710)] text-[#1a1204] shadow-[0_8px_24px_-6px_rgba(233,180,76,0.9)]"
                      style={{ width: Math.max(44, row), height: Math.max(44, row) }}
                    >
                      <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-gold/40 [animation-duration:1.6s]" />
                      <svg viewBox="0 0 24 24" className="relative ml-0.5 size-5" fill="currentColor" aria-hidden="true">
                        <path d="M7 4.5v15l13-7.5z" />
                      </svg>
                    </span>
                    <span className="flex items-center gap-1 rounded-full bg-black/80 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-gold-bright">
                      {formatTokenAmount(BigInt(bet))}
                      <Kbd>Enter</Kbd>
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
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap text-center font-mono tabular-nums ${compact ? "mt-1" : "mt-2 text-xs sm:text-sm"}`}
            style={{
              color: odds?.[suit] === 0 ? "var(--color-faint)" : SUIT_COLORS[suit],
              fontSize: compact ? Math.max(8.5, Math.min(12, row * 0.36)) : undefined,
            }}
          >
            {!odds ? "…" : odds[suit] === 0 ? "—" : compact ? shortOdds(odds[suit]) : formatMultiplier(odds[suit])}
            {!compact && (
              <span className="text-faint">
                <Kbd>{suit + 1}</Kbd>
              </span>
            )}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Odds for narrow lanes: whole numbers from 10×, one decimal below (the exact value is in the race header). */
const shortOdds = (bps: number) => {
  const value = bps / 10000;
  return value >= 10 ? String(Math.floor(value)) : String(Math.floor(value * 10) / 10);
};

/** A suit colour with transparency, for borders and tints. */
export const tint = (suit: number, alpha: number) => {
  const hex = SUIT_COLORS[suit];
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** A playing card: 300 DEGEN art on its suit colour, rank and suit in the corner. */
export function FaceCard({ card, size, dim }: { card: number; size?: { width: number; height: number }; dim?: boolean }) {
  const suit = cardSuit(card);
  const rank = cardRank(card);
  const art = cardArt(suit, rank);
  return (
    <span
      className={`relative block overflow-hidden rounded-md border bg-panel shadow-md shadow-black/40 ${size ? "" : "size-full"} ${dim ? "opacity-40" : ""}`}
      style={{ borderColor: tint(suit, art.face ? 0.95 : 0.7), ...size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.src} alt={art.alt} className="absolute inset-0 size-full object-cover" />
      <span
        className="absolute left-0.5 top-0.5 flex items-center gap-0.5 rounded bg-black/80 px-1 py-0.5 font-semibold leading-none"
        style={{ fontSize: size ? Math.max(10, Math.min(14, size.height * 0.3)) : 12 }}
      >
        {rank}
        <span style={{ color: SUIT_COLORS[suit] }}>
          {SUIT_SYMBOLS[suit]}
        </span>
      </span>
    </span>
  );
}

/** Small boards: the card as a suit-coloured tile with rank and symbol (art would be unreadable). */
function MiniCard({ card, row, dim, upright }: { card: number; row: number; dim?: boolean; upright?: boolean }) {
  const suit = cardSuit(card);
  const [width, height] = upright ? [row * 0.72, row * 0.92] : [row * 1.18, row * 0.78];
  return (
    <span
      className={`flex items-center justify-center gap-px rounded font-semibold leading-none text-white shadow-sm shadow-black/40 ${dim ? "opacity-40" : ""}`}
      style={{
        width,
        height,
        fontSize: Math.max(8, row * 0.36),
        background: `linear-gradient(160deg, ${tint(suit, 0.95)}, ${tint(suit, 0.55)})`,
        border: `1px solid ${tint(suit, 1)}`,
        flexDirection: upright ? "column" : "row",
      }}
    >
      <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">{cardRank(card)}</span>
      <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">{SUIT_SYMBOLS[suit]}</span>
    </span>
  );
}

/** The racehorse: a legendary degen on its suit colour in a gold ace frame. */
function AceCard({ suit, glow, row }: { suit: number; glow: boolean; row: number }) {
  const art = aceArt(suit);
  return (
    <span
      className={`relative block overflow-hidden rounded-md border-2 border-gold-bright ${
        glow ? "shadow-[0_0_26px_rgba(233,180,76,0.95)]" : "shadow-lg shadow-black/60"
      }`}
      style={{ height: row * 1.1, width: row * 0.82, outline: `1.5px solid ${SUIT_COLORS[suit]}`, outlineOffset: "1px" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={art.src} alt={art.alt} className="absolute inset-0 size-full object-cover object-top" />
      <span className="absolute left-0 top-0 flex items-center gap-px rounded-br bg-black/80 px-1 py-0.5 font-bold leading-none" style={{ fontSize: Math.max(9, row * 0.2) }}>
        <span className="text-gold-bright">A</span>
        <span style={{ color: SUIT_COLORS[suit] }}>{SUIT_SYMBOLS[suit]}</span>
      </span>
    </span>
  );
}

/** The ace on tiny boards: gold-rimmed chip in the suit colour. */
function AceChip({ suit, row, glow }: { suit: number; row: number; glow: boolean }) {
  return (
    <span
      className={`grid place-items-center rounded-md border border-gold-bright font-bold leading-none text-white ${glow ? "shadow-[0_0_16px_rgba(233,180,76,0.95)]" : ""}`}
      style={{ height: row * 0.86, width: row * 0.86, fontSize: Math.max(9, row * 0.5), background: `linear-gradient(160deg, ${tint(suit, 1)}, ${tint(suit, 0.5)})` }}
    >
      {SUIT_SYMBOLS[suit]}
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
