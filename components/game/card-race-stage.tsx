"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { FINISH, SUIT_SYMBOLS, SUITS, TRACK_LENGTH, cardRank, cardSuit, isRed, positionsAfter, runRace, type RaceEvent } from "@/lib/game/card-race";
import { DEGEN_COLLECTION_URL, faceArt } from "@/lib/game/card-art";
import { formatMultiplier } from "@/lib/game/catalog";

export type RacePreview = { nonce: number; serverSeedHash: string; track: number[]; odds: number[] };
export type RaceResult = { roundId: number; outcome: number; race: { track: number[]; draws: number[]; odds: number[] } };

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
};

export function CardRaceStage({ preview, result, instant, picked, onPick, disabled }: Props) {
  const reduce = useReducedMotion();
  const events = useMemo(() => (result ? raceEvents(result.race) : []), [result]);
  const [cursor, setCursor] = useState(0);
  const [round, setRound] = useState<number | null>(null);
  if ((result?.roundId ?? null) !== round) {
    setRound(result?.roundId ?? null);
    setCursor(0);
  }

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
  const lastDraw = [...played].reverse().find((event): event is Extract<RaceEvent, { kind: "draw" }> => event.kind === "draw") ?? null;
  const drawn = played.filter((event) => event.kind === "draw").length;
  const reached = played.filter((event) => event.kind === "setback").length;
  const lastEvent = played[played.length - 1];
  const finished = !!result && shown === events.length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-14 shrink-0">
          <CardBack className="absolute inset-0 translate-x-1 translate-y-1 opacity-50" />
          <CardBack className="absolute inset-0" />
        </div>
        <div className="relative h-20 w-14 shrink-0 [perspective:600px]">
          <AnimatePresence mode="popLayout">
            {lastDraw ? (
              <motion.div
                key={drawn}
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
        <p className="min-w-0 text-xs text-muted">
          {!result
            ? "Seven cards mark the track. Each turned card moves its ace one step."
            : finished
              ? `${SUITS[result.outcome]} crosses the line after ${drawn} cards.`
              : lastEvent?.kind === "setback"
                ? `All aces reached card ${lastEvent.row}: ${SUITS[lastEvent.suit]} steps back.`
                : `Card ${drawn}${lastDraw ? `: ${SUITS[lastDraw.suit]} moves up` : ""}`}
        </p>
      </div>

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
            <button
              key={suit}
              type="button"
              onClick={() => onPick(suit)}
              disabled={disabled || cannotWin}
              aria-pressed={picked === suit}
              aria-label={`Pick ${SUITS[suit]}`}
              className={`relative flex flex-col rounded-xl border transition ${
                picked === suit ? "border-gold/60 bg-gold/[0.06]" : "border-line bg-white/[0.015] enabled:hover:border-gold/30"
              } ${finished && !winner ? "opacity-50" : ""}`}
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
          );
        })}

        <span />
        {[0, 1, 2, 3].map((suit) => (
          <p key={suit} className={`mt-2 text-center font-mono text-xs tabular-nums ${odds?.[suit] === 0 ? "text-faint" : "text-gold-bright"}`}>
            {!odds ? "…" : odds[suit] === 0 ? "—" : formatMultiplier(odds[suit])}
          </p>
        ))}
      </div>
      <p className="text-[0.7rem] text-faint">
        Jacks, queens and kings:{" "}
        <a href={DEGEN_COLLECTION_URL} target="_blank" rel="noreferrer" className="text-muted underline-offset-2 hover:text-text hover:underline">
          300 DEGEN NFTs
        </a>
      </p>
    </div>
  );
}

function suitColor(suit: number) {
  return isRed(suit) ? "text-[#ff6b6b]" : "text-text";
}

export function FaceCard({ card, sideways, dim }: { card: number; sideways?: boolean; dim?: boolean }) {
  const suit = cardSuit(card);
  const rank = cardRank(card);
  const art = faceArt(suit, rank);
  return (
    <span
      className={`relative flex items-center justify-center gap-0.5 overflow-hidden rounded-md border font-semibold shadow-md shadow-black/40 ${
        art ? "border-gold/60" : "border-white/15 bg-[linear-gradient(160deg,#1d1f24,#101114)]"
      } ${sideways ? "h-8 w-12 text-[0.7rem]" : "size-full flex-col text-base"} ${dim ? "opacity-40" : ""}`}
    >
      {art ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art.src} alt={art.alt} className="absolute inset-0 size-full object-cover" />
          <span className="absolute left-0.5 top-0.5 flex items-center gap-px rounded bg-black/75 px-1 py-px text-[0.6rem] leading-none">
            {rank}
            <span className={suitColor(suit)}>{SUIT_SYMBOLS[suit]}</span>
          </span>
        </>
      ) : (
        <>
          <span className="leading-none">{rank}</span>
          <span className={`leading-none ${sideways ? "text-base" : "text-xl"} ${suitColor(suit)}`}>{SUIT_SYMBOLS[suit]}</span>
        </>
      )}
    </span>
  );
}

function AceCard({ suit, glow }: { suit: number; glow: boolean }) {
  return (
    <span
      className={`relative flex h-9 w-7 flex-col items-center justify-center rounded-md border bg-[linear-gradient(160deg,#23201a,#0f0e0c)] shadow-lg sm:w-8 ${
        glow ? "border-gold-bright shadow-[0_0_24px_rgba(233,180,76,0.8)]" : "border-gold/50 shadow-black/50"
      }`}
    >
      <span className="absolute left-1 top-0.5 text-[0.55rem] font-bold leading-none text-gold-bright">A</span>
      <span className={`text-lg leading-none ${suitColor(suit)}`}>{SUIT_SYMBOLS[suit]}</span>
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
