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
/**
 * Row heights: a board fits both its width (per = rows across) and its height
 * (rows = row heights stacked, fixed = pixels of text around them), within min and max.
 * Small boards accept narrow lanes, so on phones their rows grow with the height.
 * The single board keeps its deck in a column beside the lanes, so all its height goes to the rows.
 * When the width sets the card size, the rows may grow taller than the cards (up to STRETCH):
 * the track gets longer and fills the screen, the cards keep their size.
 */
const STRETCH = 1.35;
const FULL_ROW = { min: 18, max: 72, per: 8.0, rows: 9, fixed: 68 };
const COMPACT_ROW = { min: 12, max: 42, per: 6.1, rows: 9.2, fixed: 18 };
/** Ace size in rows: a little wider than a lane's share and taller than its row. */
const ACE = { width: 1.1, height: 1.5 };

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
  /** The chips on the lanes (♠ ♥ ♦ ♣), 0 where there is none. */
  stakes: readonly number[] | null;
  /** A tap on a lane places a chip there. */
  onPick(suit: number): void;
  disabled: boolean;
  /** Small board for the 4× grid: no card carousel, rows scale with the width. */
  compact?: boolean;
  /** Changing this number plays the finished race again (the replay button in the terminal). */
  replay?: number;
};

export function CardRaceStage({ deal, result, instant, stakes, onPick, disabled, compact = false, replay = 0 }: Props) {
  const reduce = useReducedMotion();
  const events = useMemo(() => (result ? raceEvents(result.race) : []), [result]);
  const [cursor, setCursor] = useState(0);
  const [round, setRound] = useState<number | null>(null);
  // A replay runs the finished race again from the first card; nothing is bet.
  const [replaying, setReplaying] = useState(false);
  const [replayRun, setReplayRun] = useState(0);
  const [seenReplay, setSeenReplay] = useState(replay);
  if ((result?.roundId ?? null) !== round) {
    setRound(result?.roundId ?? null);
    setCursor(0);
    setReplaying(false);
  }
  const startReplay = () => {
    setReplaying(true);
    setCursor(0);
    setReplayRun((run) => run + 1);
  };
  if (replay !== seenReplay) {
    setSeenReplay(replay);
    if (result) startReplay();
  }

  // The board sizes its rows from the room it gets, so it always fits and grows with the screen.
  const shell = useRef<HTMLDivElement>(null);
  const bounds = compact ? COMPACT_ROW : FULL_ROW;
  const [{ row, step }, setSize] = useState({ row: compact ? 24 : 44, step: compact ? 24 : 44 });
  useEffect(() => {
    // Measure the room around the board: the board itself is narrowed to its rows below.
    const room = shell.current?.parentElement;
    if (!room) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const tall = height > 0 ? (height - bounds.fixed) / bounds.rows : Infinity;
      const next = Math.min(bounds.max, Math.max(bounds.min, Math.floor(Math.min(width / bounds.per, tall))));
      setSize({ row: next, step: Math.max(next, Math.floor(Math.min(tall, next * STRETCH))) });
    });
    observer.observe(room);
    return () => observer.disconnect();
  }, [bounds]);
  const deck = { width: Math.round(row * 1.36), height: Math.round(row * 1.9) };
  const trailCard = { width: Math.round(row * 1.0), height: Math.round(row * 1.4) };

  // Warm the browser cache with all card images so turned cards never show up blank.
  useEffect(() => {
    for (let card = 0; card < DECK_SIZE; card += 1) new Image().src = cardArt(cardSuit(card), cardRank(card)).src;
    for (let suit = 0; suit < 4; suit += 1) new Image().src = aceArt(suit).src;
  }, []);

  useEffect(() => {
    if (!result || reduce || (instant && !replaying)) return;
    const { at, total } = raceTimeline(events);
    const timers = at.map((time, index) => window.setTimeout(() => setCursor(index + 1), time));
    if (replaying) timers.push(window.setTimeout(() => setReplaying(false), total));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [result, events, instant, reduce, replaying, replayRun]);

  const shown = result && (instant || reduce) && !replaying ? events.length : cursor;
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
    <div
      ref={shell}
      className={`mx-auto flex h-full min-h-0 w-full flex-col ${compact ? "gap-1.5" : "gap-3"}`}
      // Lanes stay in proportion to the aces when the height, not the width, sets the row size.
      style={{ maxWidth: Math.round(row * (compact ? 9.4 : 11.9)) }}
    >
      {!compact && (
        <>
          <p className="min-h-5 text-xs text-muted sm:text-sm" aria-live="polite">
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
        className="relative grid"
        style={{
          gridTemplateColumns: `${Math.round(row * (compact ? 1.3 : 1.45))}px repeat(4, minmax(0, 1fr))${compact ? "" : ` ${Math.round(row * 1.4)}px`}`,
          columnGap: compact ? 2 : Math.round(row / 10),
        }}
      >
        {/* Track column: finish flag on top, the seven cards below, the gate (or the turned card) at the bottom. */}
        <div className="flex flex-col">
          <div style={{ height: step }} />
          {Array.from({ length: TRACK_LENGTH }, (_, index) => TRACK_LENGTH - index).map((level) => (
            <div key={level} className="grid place-items-center" style={{ height: step }}>
              {track ? (
                <motion.div
                  animate={level <= reached ? { scale: [1, 1.12, 1] } : { scale: 1 }}
                  transition={{ duration: 0.4 }}
                  className={`rounded-md ${level <= reached ? "ring-2 ring-gold/70" : ""}`}
                >
                  <SidewaysCard
                    card={track[level - 1]}
                    width={Math.round(row * (compact ? 1.22 : 1.36))}
                    height={Math.round(row * (compact ? 0.86 : 0.94))}
                    dim={level <= reached && !(lastEvent?.kind === "setback" && lastEvent.row === level)}
                  />
                </motion.div>
              ) : (
                <span className="rounded-md bg-white/[0.04]" style={{ height: row * 0.9, width: row * 1.3 }} />
              )}
            </div>
          ))}
          <div className="grid place-items-center" style={{ height: step }}>
            {compact && lastDraw ? (
              <motion.div key={lastDraw.card} initial={{ rotateY: 90 }} animate={{ rotateY: 0 }} transition={{ duration: 0.18 }}>
                <FaceCard card={lastDraw.card} size={{ width: Math.round(row * 0.68), height: Math.round(row * 0.95) }} />
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
          const cannotWin = odds?.[suit] === 0;
          const stake = stakes?.[suit] ?? 0;
          const staked = stake > 0;
          // The latest card moved this ace: up (gloating) or back (angry).
          const mood: Mood | null =
            lastEvent?.kind === "setback" && lastEvent.suit === suit ? "angry" : lastEvent?.kind === "draw" && lastEvent.suit === suit ? "happy" : null;
          return (
            <div key={suit} className="relative flex">
              <button
                type="button"
                onClick={() => onPick(suit)}
                disabled={disabled || cannotWin}
                aria-pressed={staked}
                aria-label={staked ? `${SUITS[suit]}: ${formatTokenAmount(BigInt(stake))} placed, add a chip` : `Place a chip on ${SUITS[suit]}`}
                className={`relative flex w-full flex-col rounded-lg transition enabled:hover:bg-white/[0.035] ${finished && !winner ? "opacity-45" : ""}`}
                style={{ backgroundColor: staked ? tint(suit, 0.07) : undefined }}
              >
                {Array.from({ length: FINISH + 1 }, (_, level) => (
                  <span key={level} style={{ height: step }} />
                ))}
                {/* The track: one line from the gate to the finish, a tick for every step. */}
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 -translate-x-1/2 rounded-full"
                  style={{
                    top: step / 2,
                    bottom: step / 2,
                    width: staked ? 3 : 2,
                    background: staked ? "linear-gradient(180deg,#ffe7a8,#e9b44c)" : tint(suit, 0.5),
                    boxShadow: staked ? "0 0 10px rgba(233,180,76,0.55)" : undefined,
                  }}
                />
                {Array.from({ length: TRACK_LENGTH }, (_, index) => (
                  <span
                    key={index}
                    aria-hidden="true"
                    className="absolute left-1/2 h-[2px] -translate-x-1/2 rounded-full"
                    style={{ top: (index + 1) * step + step / 2 - 1, width: Math.round(row * 0.32), background: tint(suit, 0.45) }}
                  />
                ))}
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                  style={{ top: FINISH * step + step / 2, width: Math.round(row * 0.3), height: Math.round(row * 0.3), borderColor: tint(suit, 0.6) }}
                />
                {/* The chip waits on the finish line for its ace, with the multiplier it pays. */}
                {staked && (
                  <span
                    className="absolute left-1/2 z-[5] flex flex-col items-center"
                    style={{ top: step / 2, transform: "translate(-50%, -0.75em)", fontSize: Math.max(8, Math.min(13, row * 0.26)) }}
                  >
                    <span className="whitespace-nowrap rounded-full border border-gold-bright/80 bg-[linear-gradient(135deg,#f4d675,#9b6710)] px-1.5 font-bold leading-snug tabular-nums text-[#1a1204] shadow-md shadow-black/60">
                      {formatTokenAmount(BigInt(stake))}
                    </span>
                    {odds && odds[suit] > 0 && (
                      <span
                        className="mt-px whitespace-nowrap rounded bg-black/75 px-1 font-mono font-bold leading-tight tabular-nums"
                        style={{ color: SUIT_COLORS[suit], fontSize: "0.9em" }}
                      >
                        {compact ? `${shortOdds(odds[suit])}×` : formatMultiplier(odds[suit])}
                      </span>
                    )}
                  </span>
                )}
                <motion.div
                  className="absolute inset-x-0 bottom-0 z-10 grid place-items-center"
                  style={{ height: step }}
                  animate={{ y: -position * step }}
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                >
                  <motion.div
                    key={mood ? `${mood}-${shown}` : "still"}
                    animate={
                      reduce || !mood
                        ? {}
                        : mood === "happy"
                          ? { y: [0, -row * 0.2, 0], rotate: [0, -5, 0] }
                          : { x: [0, -row * 0.09, row * 0.09, -row * 0.05, 0], rotate: [0, 4, -4, 0] }
                    }
                    transition={{ duration: 0.36 }}
                  >
                    <AceCard suit={suit} glow={winner} row={row} angry={mood === "angry"} />
                  </motion.div>
                  <AnimatePresence>
                    {mood && !reduce && (
                      <motion.span
                        key={`${mood}-${shown}`}
                        className="pointer-events-none absolute z-20"
                        style={{ left: `calc(50% + ${row * 0.22}px)`, top: step / 2 - row * 1.2, width: Math.round(row * 0.8), height: Math.round(row * 0.8) }}
                        initial={{ opacity: 0, scale: 0.3, y: row * 0.2 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.6 }}
                        transition={{ type: "spring", stiffness: 520, damping: 22 }}
                      >
                        <MoodFace mood={mood} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              </button>
            </div>
          );
        })}

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0 z-0 rounded-sm bg-[repeating-conic-gradient(#e9b44c_0_25%,#0b0b0c_0_50%)] opacity-90 shadow-[0_0_12px_rgba(233,180,76,0.35)]"
          style={{
            top: Math.round(step / 2 - Math.max(6, row * 0.26) / 2),
            height: Math.round(Math.max(6, row * 0.26)),
            right: compact ? 0 : Math.round(row * 1.4) + Math.round(row / 5),
            backgroundSize: `${Math.max(4, Math.round(row / 5))}px ${Math.max(4, Math.round(row / 5))}px`,
          }}
        />

        {!compact && (
          <div className="flex flex-col items-center" style={{ gap: Math.round(row * 0.35) }} aria-hidden="true">
            <div className="relative shrink-0 [perspective:600px]" style={deck}>
              <CardBack className="absolute inset-0 translate-x-1 translate-y-1 opacity-50" />
              <CardBack className="absolute inset-0" />
              <AnimatePresence mode="popLayout">
                {lastDraw && (
                  <motion.div
                    key={lastDraw.card}
                    className="absolute inset-0 z-10"
                    initial={{ rotateY: 180, y: -8, opacity: 0.6 }}
                    animate={{ rotateY: 0, y: 0, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                  >
                    <FaceCard card={lastDraw.card} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <div className="flex flex-col items-center">
              <AnimatePresence initial={false}>
                {trail.map((event, index) => (
                  <motion.div
                    key={event.card}
                    layout
                    className="relative shrink-0"
                    style={{ zIndex: TRAIL - index, ...trailCard, marginTop: index === 0 ? 0 : -trailCard.height * 0.62 }}
                    initial={{ opacity: 0, y: -28, scale: 1.15 }}
                    animate={{ opacity: 1 - index * 0.17, y: 0, scale: 1 - index * 0.07, rotate: index * 3 }}
                    exit={{ opacity: 0, y: 18, scale: 0.6, rotate: 12 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <FaceCard card={event.card} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        <span />
        {[0, 1, 2, 3].map((suit) => (
          <p
            key={suit}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap text-center font-mono tabular-nums ${compact ? "" : "text-xs sm:text-sm"}`}
            style={{
              color: odds?.[suit] === 0 ? "var(--color-faint)" : SUIT_COLORS[suit],
              fontSize: compact ? Math.max(8.5, Math.min(12, row * 0.36)) : undefined,
              // The ace stands a little taller than its row; keep the odds clear of it.
              marginTop: Math.round(Math.max(compact ? 4 : 8, (row * ACE.height) / 2 - step / 2 + 3 + Math.max(compact ? 3 : 6, row * 0.18))),
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
        {!compact && <span />}
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

/**
 * A card of the 300 deck: its DEGEN art in a gold frame with a foil sheen. No
 * printed rank — only the suit matters in the race, and the art's background
 * already is the suit's colour.
 */
export function FaceCard({ card, size, dim }: { card: number; size?: { width: number; height: number }; dim?: boolean }) {
  const suit = cardSuit(card);
  const art = cardArt(suit, cardRank(card));
  return (
    <span
      className={`relative block rounded-[14%/10%] bg-[linear-gradient(145deg,#ffe7a8,#e9b44c_42%,#a8691c)] p-[6%] shadow-md shadow-black/50 ${size ? "" : "size-full"} ${dim ? "opacity-40" : ""}`}
      style={size}
    >
      <CardArt src={art.src} alt={art.alt} color={SUIT_COLORS[suit]} />
    </span>
  );
}

/** The art inside a card frame: cut to the card, the figure centred, a sheen on top. */
function CardArt({ src, alt, color }: { src: string; alt: string; color: string }) {
  return (
    <span className="relative block size-full overflow-hidden rounded-[10%/7%]" style={{ backgroundColor: color }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" style={{ objectPosition: "50% 35%" }} />
      <span className="absolute inset-0 bg-[linear-gradient(125deg,rgba(255,255,255,0.24),transparent_32%,transparent_68%,rgba(0,0,0,0.28))]" />
    </span>
  );
}

/** A track card lies on its side: the upright NFT card turned a quarter, so the art is whole. */
function SidewaysCard({ card, width, height, dim }: { card: number; width: number; height: number; dim?: boolean }) {
  return (
    <span className="grid place-items-center" style={{ width, height }}>
      <span className="-rotate-90">
        <FaceCard card={card} size={{ width: height, height: width }} dim={dim} />
      </span>
    </span>
  );
}

type Mood = "happy" | "angry";

/** The racehorse: a legendary degen in a heavier gold frame with a ring in its suit colour. */
function AceCard({ suit, glow, row, angry }: { suit: number; glow: boolean; row: number; angry?: boolean }) {
  const art = aceArt(suit);
  return (
    <span
      className={`relative block rounded-[14%/10%] bg-[linear-gradient(145deg,#fff1c4,#ffd779_30%,#e9b44c_55%,#a8691c)] p-[7%] ${
        glow ? "shadow-[0_0_28px_rgba(233,180,76,0.95)]" : "shadow-lg shadow-black/60"
      }`}
      style={{ height: row * ACE.height, width: row * ACE.width, outline: `2px solid ${SUIT_COLORS[suit]}`, outlineOffset: "1px" }}
    >
      <CardArt src={art.src} alt={art.alt} color={SUIT_COLORS[suit]} />
      {angry && (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-[14%/10%] bg-danger"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.45, 0] }}
          transition={{ duration: 0.45 }}
        />
      )}
    </span>
  );
}

/** A face that pops out of an ace: gloating when it moves up, fuming when it has to step back. */
function MoodFace({ mood }: { mood: Mood }) {
  if (mood === "happy") {
    return (
      <svg viewBox="0 0 40 40" className="size-full drop-shadow-[0_3px_6px_rgba(0,0,0,0.6)]" aria-hidden="true">
        <circle cx="20" cy="20" r="17.5" fill="#ffd779" stroke="#11141c" strokeWidth="2.5" />
        <path d="M9.5 16.5 Q13.5 11.5 17.5 16.5 M22.5 16.5 Q26.5 11.5 30.5 16.5" stroke="#11141c" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M10.5 22 Q20 34 30.5 21 Q21 26.5 10.5 22 Z" fill="#7d1d18" stroke="#11141c" strokeWidth="2" strokeLinejoin="round" />
        <path d="M13 23.4 Q20 26.8 28.4 22.6" stroke="#fff4d6" strokeWidth="1.6" fill="none" />
        <path d="M30 20 l3.5 -3" stroke="#11141c" strokeWidth="2" strokeLinecap="round" />
        <path d="M34 6 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2 Z" fill="#fff4d6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 40 40" className="size-full drop-shadow-[0_3px_6px_rgba(0,0,0,0.6)]" aria-hidden="true">
      <g fill="#e8e2d0" opacity="0.85">
        <circle cx="6" cy="7" r="3.2" />
        <circle cx="3.5" cy="3.5" r="2.2" />
        <circle cx="34" cy="7" r="3.2" />
        <circle cx="36.5" cy="3.5" r="2.2" />
      </g>
      <circle cx="20" cy="21" r="17" fill="#ff6b6b" stroke="#11141c" strokeWidth="2.5" />
      <path d="M9 14.5 L17 17.5 M31 14.5 L23 17.5" stroke="#11141c" strokeWidth="3" strokeLinecap="round" />
      <circle cx="14" cy="21.5" r="2.4" fill="#11141c" />
      <circle cx="26" cy="21.5" r="2.4" fill="#11141c" />
      <path d="M12.5 31 Q20 24.5 27.5 31" stroke="#11141c" strokeWidth="2.8" fill="none" strokeLinecap="round" />
    </svg>
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
