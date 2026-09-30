"use client";

import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { SUIT_COLORS, SUIT_SYMBOLS, SUITS } from "@/lib/game/card-race";
import { DEGEN_COLLECTION_URL } from "@/lib/game/card-art";
import { formatMultiplier } from "@/lib/game/catalog";
import { play } from "@/lib/sound";
import { STRATEGIES, layoutStakes, type ChipPlacement, type RaceStrategy } from "@/lib/game/race-strategy";
import type { ArenaGame, RaceTicket } from "./arena";
import { WinBurst } from "./arena-effects";
import { CardRaceStage, type RaceDeal, type RacePace } from "./card-race-stage";
import { GameFrame, Kbd, stepBet, useGameKeys, type GameToast } from "./game-frame";
import { StrategyPicker } from "./race-strategy";
import { GamePanel, useAutoRun, useStopWhenHidden, type AutoMode, type WalletPanels } from "./terminal";

export type RaceDeals = { nonce: number; serverSeedHash: string; deals: RaceDeal[] };
export type StakedRace = {
  outcome: number;
  nonce: number;
  rounds: { roundId: number; choice: number; bet: number; win: boolean; payout: number }[];
  race: { track: number[]; draws: number[]; odds: number[] };
};
export type StakedRaces = { results: (StakedRace | null)[]; balance: number };

type Props = {
  game: ArenaGame;
  bets: { min: number; max: number; step: number };
  balance: number;
  enabled: boolean;
  /** One race, or four at once like the four games of a "Pharao" machine. */
  count: 1 | 4;
  onCount(count: 1 | 4): void;
  loadRaces(count: number): Promise<RaceDeals>;
  playStakes(stakes: number[], ticket: RaceTicket): Promise<StakedRaces>;
  dealVersion: number;
  onSettled(): void;
  onBack(): void;
  wallet: WalletPanels;
};

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const PACE_KEY = "300spo:race-pace";
const readPace = (): RacePace => {
  try {
    const saved = localStorage.getItem(PACE_KEY);
    return saved === "step" || saved === "fast" ? saved : "auto";
  } catch {
    return "auto";
  }
};
/** Where each race of the 4× grid shows its chips' odds: its outer corner. */
const CORNER = ["left-0.5 top-0.5", "right-0.5 top-0.5", "bottom-0.5 left-0.5", "bottom-0.5 right-0.5"];

/**
 * The horse race: one race or four. The player taps lanes to put the chip from
 * the terminal on them (any lanes, up to the max bet each), or places chips by
 * colour or odds on every race at once. The chips stay for the next deal, so
 * Start or auto play bets the same layout again.
 */
export function RaceTable({ game, bets, balance, enabled, count, onCount, loadRaces, playStakes, dealVersion, onSettled, onBack, wallet }: Props) {
  const reduce = useReducedMotion();
  const quad = count > 1;
  const [chip, setChip] = useState(bets.min);
  const [placements, setPlacements] = useState<ChipPlacement[]>([]);
  const [phase, setPhase] = useState<"idle" | "waiting" | "animating" | "done">("idle");
  const [outcome, setOutcome] = useState<StakedRaces | null>(null);
  const [deals, setDeals] = useState<RaceDeals | null>(null);
  const [dealKey, setDealKey] = useState(0);
  const [playedNonce, setPlayedNonce] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState<AutoMode>("off");
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);
  const [lastWin, setLastWin] = useState<number | null>(null);
  // Bumped by the replay button: the finished races run again.
  const [replay, setReplay] = useState(0);
  const [bursts, setBursts] = useState<number[]>([]);
  // The race the number keys place chips on.
  const [active, setActive] = useState(0);
  // How races play out: the player's choice, and what the running round uses (auto play never waits for taps).
  const [pace, setPace] = useState<RacePace>(readPace);
  const [roundPace, setRoundPace] = useState<RacePace>("auto");
  const [advance, setAdvance] = useState(0);
  // After four races: their wins counted up to one sum.
  const [tally, setTally] = useState<{ id: string; wins: number[] } | null>(null);
  // Races that have reached their finish this round, and the wins already celebrated.
  const finishedBoards = useRef(new Set<number>());
  const celebrated = useRef(new Set<number>());
  const grid = useRef<HTMLDivElement>(null);

  const changePace = (next: RacePace) => {
    setPace(next);
    try {
      localStorage.setItem(PACE_KEY, next);
    } catch {
      // Only the next visit forgets it.
    }
  };

  useEffect(() => {
    let live = true;
    loadRaces(count).then(
      (loaded) => live && setDeals(loaded),
      () => live && setError("Could not deal the races. Reload the page."),
    );
    return () => {
      live = false;
    };
  }, [loadRaces, count, dealKey, dealVersion]);

  // A race's win is celebrated the moment its ace crosses the line (not in fast pace).
  const celebrate = useCallback(
    (race: StakedRace, pace: RacePace) => {
      const id = race.rounds[0].roundId;
      if (pace === "fast" || reduce || celebrated.current.has(id) || !race.rounds.some((round) => round.win)) return;
      celebrated.current.add(id);
      setBursts((current) => [...current, id]);
    },
    [reduce],
  );

  const finish = useCallback(
    (result: StakedRaces, pace: RacePace) => {
      setPhase("done");
      const races = result.results.filter((race): race is StakedRace => !!race);
      // After a skip, the wins not celebrated yet are now.
      races.forEach((race) => celebrate(race, pace));
      const wins = races.map((race) => sum(race.rounds.map((round) => round.payout))).filter((won) => won > 0);
      const payout = sum(wins);
      if (payout > 0) setLastWin(payout);
      if (quad && wins.length > 0 && pace !== "fast" && !reduce) setTally({ id: races.map((race) => race.rounds[0].roundId).join("-"), wins });
      setDealKey((key) => key + 1);
      onSettled();
    },
    [onSettled, celebrate, quad, reduce],
  );

  const busy = phase === "waiting" || phase === "animating";
  const fresh = !!deals && deals.nonce !== playedNonce;
  const available = phase === "done" && outcome ? outcome.balance : balance;
  const stakes = deals ? layoutStakes(placements, deals.deals.map((deal) => deal.odds), bets.max) : Array.from({ length: count }, () => [0, 0, 0, 0]);
  const total = sum(stakes.flat());
  const racesStaked = stakes.filter((lanes) => sum(lanes) > 0).length;
  const canStart = enabled && !busy && fresh && total > 0 && total <= available;
  const showResult = phase === "animating" || phase === "done";
  const shownBalance = busy ? balance - total : available;
  const played = outcome?.results.filter((race): race is StakedRace => !!race) ?? [];
  const winnings = sum(played.flatMap((race) => race.rounds.map((round) => round.payout)));
  // One stable result per race: a new object on every render would restart the races still running.
  const raceResults = useMemo(
    () => (outcome?.results ?? []).map((race) => (race ? { roundId: race.rounds[0].roundId, outcome: race.outcome, race: race.race } : null)),
    [outcome],
  );
  const rules = placements.flatMap((placement) => (placement.kind === "rule" ? [placement.strategy] : []));

  // A finished race stays on screen until the player changes the chips or starts again.
  const reopen = () => {
    if (phase !== "done") return;
    setPhase("idle");
    setOutcome(null);
    setBursts([]);
    setTally(null);
  };
  const place = (placement: ChipPlacement) => {
    if (busy) return;
    reopen();
    setNote(null);
    play("chip");
    setPlacements((current) => [...current, placement]);
  };
  const placeOnLane = (board: number, suit: number) => {
    if (busy) return;
    if ((stakes[board]?.[suit] ?? 0) >= bets.max) {
      setNote((current) => ({ id: (current?.id ?? 0) + 1, text: `${formatTokenAmount(BigInt(bets.max))} is the most on one lane` }));
      return;
    }
    setActive(board);
    place({ kind: "lane", board, suit, amount: chip });
  };
  const placeRule = (strategy: RaceStrategy) => place({ kind: "rule", strategy, amount: chip });
  const undo = () => {
    if (busy || !placements.length) return;
    reopen();
    play("click");
    setPlacements((current) => current.slice(0, -1));
  };
  const clear = () => {
    if (busy || !placements.length) return;
    reopen();
    play("click");
    setPlacements([]);
  };

  const start = async (fromAuto = false) => {
    if (!deals || !canStart) return;
    setPlayedNonce(deals.nonce);
    setError(null);
    setNote(null);
    setOutcome(null);
    setBursts([]);
    setTally(null);
    finishedBoards.current = new Set();
    celebrated.current = new Set();
    // Auto play never waits for taps.
    setRoundPace(fromAuto && pace === "step" ? "auto" : pace);
    setPhase("waiting");
    try {
      const result = await playStakes(stakes.flat(), { nonce: deals.nonce, serverSeedHash: deals.serverSeedHash });
      setOutcome(result);
      setPhase("animating");
      play("start");
      const box = grid.current?.getBoundingClientRect();
      if (!fromAuto && box && (box.top < 0 || box.top > window.innerHeight * 0.5)) grid.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    } catch (cause) {
      setPhase("idle");
      setAuto("off");
      setError(cause instanceof Error ? cause.message : "The races could not start.");
      setDealKey((key) => key + 1);
    }
  };

  // Auto play bets the same chips on every new deal; it stops when they cannot be placed.
  const changeAuto = useCallback((mode: AutoMode) => {
    setAuto(mode);
    setNote(null);
  }, []);
  const stopAuto = useCallback(() => setAuto("off"), []);
  useStopWhenHidden(auto, stopAuto);
  const canAuto = enabled && placements.length > 0;
  useAutoRun(auto, enabled && !busy && fresh, () => {
    const reason = !placements.length ? "place chips first" : total === 0 ? "no ace fits these chips" : total > available ? "not enough game balance" : null;
    if (reason) {
      setAuto("off");
      setNote({ id: Date.now(), text: `Auto stopped · ${reason}` });
      return;
    }
    void start(true);
  });

  // Each race reports its finish; when all have, the round is over.
  const boardDone = (index: number) => {
    if (phase !== "animating" || !outcome || finishedBoards.current.has(index)) return;
    finishedBoards.current.add(index);
    const race = outcome.results[index];
    if (race) celebrate(race, roundPace);
    const raced = outcome.results.filter(Boolean).length;
    if (finishedBoards.current.size >= raced) finish(outcome, roundPace);
  };

  const canSkip = phase === "animating" && !!outcome;
  const skip = () => outcome && finish(outcome, roundPace);
  const stepping = phase === "animating" && roundPace === "step";
  const turnCard = () => stepping && setAdvance((count) => count + 1);
  const canReplay = phase === "done" && !!outcome && auto === "off" && !reduce;
  const changeChip = (direction: 1 | -1) => !busy && setChip(stepBet(bets, chip, direction));

  useGameKeys({
    "1": () => placeOnLane(active, 0),
    "2": () => placeOnLane(active, 1),
    "3": () => placeOnLane(active, 2),
    "4": () => placeOnLane(active, 3),
    left: () => quad && setActive((board) => (board + count - 1) % count),
    right: () => quad && setActive((board) => (board + 1) % count),
    backspace: undo,
    x: clear,
    up: () => changeChip(1),
    down: () => changeChip(-1),
    plus: () => changeChip(1),
    minus: () => changeChip(-1),
    enter: () => (stepping ? turnCard() : canStart && void start()),
    space: () => (stepping ? turnCard() : canStart && void start()),
    s: canSkip && skip,
    a: () => (auto !== "off" ? changeAuto("off") : canAuto && changeAuto("lock")),
    ...Object.fromEntries(STRATEGIES.map((entry) => [entry.key, () => placeRule(entry.id)])),
  });

  const prompt =
    auto !== "off" ? (
      "Auto play is on"
    ) : stepping ? (
      "Tap the board or the button to turn the next card"
    ) : busy ? (
      "Racing…"
    ) : total === 0 ? (
      quad ? "Tap lanes in any race to place the chip" : "Tap a lane to place the chip"
    ) : total > available ? (
      "Not enough balance for these chips"
    ) : (
      <>
        <span className="pointer-fine:hidden">Tap to start · hold for auto</span>
        <span className="hidden pointer-fine:inline">{quad ? "← → race · " : ""}1–4 chip · ⌫ undo · Enter start · A auto</span>
      </>
    );

  const toast: GameToast | null = error
    ? { id: `error-${error}`, text: error, tone: "error" }
    : note
      ? { id: note.id, text: note.text, tone: "warn" }
      : phase === "done" && outcome && played.length
        ? {
            id: played.map((race) => race.rounds[0].roundId).join("-"),
            text: quad
              ? `${winnings > 0 ? `+${formatTokenAmount(BigInt(winnings))} · ` : ""}${played.filter((race) => race.rounds.some((round) => round.win)).length} of ${played.length} won · ${played
                  .map((race) => SUIT_SYMBOLS[race.outcome])
                  .join(" ")}`
              : `${winnings > 0 ? `+${formatTokenAmount(BigInt(winnings))} · ` : ""}${SUITS[played[0].outcome]} won`,
            tone: winnings > 0 ? "win" : "info",
          }
        : !enabled
          ? { id: "paused", text: "Games are paused right now.", tone: "warn" }
          : null;

  const panel = (
    <GamePanel
      prompt={prompt}
      options={<StrategyPicker active={rules} onPlace={placeRule} disabled={busy} />}
      bet={{ bets, bet: chip, onChange: setChip, disabled: busy, affordable: (amount) => amount <= available }}
      play={{
        label: stepping
          ? "Next card"
          : total === 0
            ? "Place chips"
            : total > available
              ? "Not enough balance"
              : quad
                ? `Start ${racesStaked} race${racesStaked === 1 ? "" : "s"}`
                : "Start race",
        amount: total,
        onPlay: () => (stepping ? turnCard() : void start()),
        playable: stepping || canStart || (canAuto && !busy),
        auto,
        onAuto: changeAuto,
        kbd: canStart ? <Kbd>Enter</Kbd> : null,
      }}
      lead={
        canReplay ? (
          <button
            type="button"
            onClick={() => setReplay((run) => run + 1)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-3 text-xs font-semibold text-gold-bright transition hover:bg-gold/20"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Replay
          </button>
        ) : undefined
      }
      below={
        <div className="flex flex-wrap items-center gap-1.5">
          <RaceModes quad={quad} onQuad={(value) => onCount(value ? 4 : 1)} pace={pace} onPace={changePace} disabled={busy} />
          <ChipStepper chip={chip} bets={bets} onStep={changeChip} disabled={busy} affordable={chip <= available} />
          <div className="ml-auto flex gap-1">
            <IconButton label="Undo the last chip" onClick={undo} disabled={busy || !placements.length}>
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
            </IconButton>
            <IconButton label="Clear all chips" onClick={clear} disabled={busy || !placements.length}>
              <path d="M18 6 6 18M6 6l12 12" />
            </IconButton>
          </div>
        </div>
      }
      extra={
        canSkip &&
        auto === "off" && (
          <button className="inline-flex items-center gap-2 self-center text-xs text-faint hover:text-text" onClick={skip}>
            Skip to the finish <Kbd>S</Kbd>
          </button>
        )
      }
      lastWin={lastWin}
      balance={shownBalance}
      wallet={wallet}
    />
  );

  const info = (
    <>
      <span className="block">Four legendary aces race the deck. Tap a lane to put the chip from the terminal on it; tap again for more, up to {formatTokenAmount(BigInt(bets.max))} per lane.</span>
      <span className="mt-2 block">The colours and Low, Mid, High put the chip on every race at once. A lane whose ace crosses the finish line first pays its odds.</span>
      {quad && <span className="mt-2 block">In 4× mode four races run at once, each with its own track and odds.</span>}
      <span className="mt-2 block text-xs text-faint">
        Card art:{" "}
        <a href={DEGEN_COLLECTION_URL} target="_blank" rel="noreferrer" className="text-gold-bright underline-offset-2 hover:underline">
          300 DEGEN NFTs
        </a>
      </span>
    </>
  );

  // What each race shows: its result while racing and after, otherwise the deal with the chips on it.
  const board = (index: number) => {
    const race = showResult ? (outcome?.results[index] ?? null) : null;
    const lanes = race ? [0, 1, 2, 3].map((suit) => sum(race.rounds.filter((round) => round.choice === suit).map((round) => round.bet))) : showResult ? null : stakes[index];
    return {
      race,
      lanes,
      stage: (
        <CardRaceStage
          compact={quad}
          deal={deals?.deals[index] ?? null}
          result={race ? (raceResults[index] ?? null) : null}
          instant={phase === "done"}
          stakes={lanes}
          onPick={(suit) => placeOnLane(index, suit)}
          disabled={busy}
          replay={replay}
          pace={roundPace}
          advance={advance}
          onDone={() => boardDone(index)}
        />
      ),
    };
  };

  return (
    <GameFrame gameId="card-race" payoutBps={game.payoutBps} onBack={onBack} info={info} panel={panel} toast={toast}>
      {quad ? (
        <div ref={grid} className="relative grid h-full grid-cols-2 grid-rows-2 gap-1 p-1 sm:gap-2 sm:p-0">
          {stepping && <StepCatcher onStep={turnCard} />}
          <AnimatePresence>{tally && <WinTally key={tally.id} wins={tally.wins} onDone={() => setTally(null)} />}</AnimatePresence>
          {Array.from({ length: count }, (_, index) => {
            const { race, lanes, stage } = board(index);
            const won = race ? sum(race.rounds.map((round) => round.payout)) : 0;
            const odds = race?.race.odds ?? deals?.deals[index]?.odds ?? null;
            const chips = (lanes ?? []).flatMap((amount, suit) => (amount > 0 ? [suit] : []));
            return (
              <div
                key={index}
                className={`relative flex min-h-0 min-w-0 flex-col rounded-xl border bg-ink/40 p-1 transition ${
                  active === index && !busy ? "border-gold/50 pointer-fine:shadow-[0_0_0_1px_rgba(233,180,76,0.25)]" : "border-line"
                }`}
                onPointerDown={() => setActive(index)}
              >
                <div className="min-h-0 flex-1">{stage}</div>
                {/* The odds of this race's chips, or its win, at the grid's outer corner. */}
                {(chips.length > 0 || won > 0) && (
                  <span
                    className={`pointer-events-none absolute z-20 flex items-center gap-1 rounded-md bg-black/80 px-1 py-px font-mono text-[0.6rem] font-semibold leading-tight tabular-nums shadow ${CORNER[index]}`}
                  >
                    {phase === "done" && race ? (
                      won > 0 ? (
                        <span className="text-positive">+{formatTokenAmount(BigInt(won))}</span>
                      ) : (
                        <span className="text-faint">{SUIT_SYMBOLS[race.outcome]} won</span>
                      )
                    ) : (
                      chips.map((suit) => (
                        <span key={suit} style={{ color: SUIT_COLORS[suit] }}>
                          {SUIT_SYMBOLS[suit]}
                          {odds ? formatMultiplier(odds[suit]).replace("×", "") : ""}
                        </span>
                      ))
                    )}
                  </span>
                )}
                <AnimatePresence>
                  {race && bursts.includes(race.rounds[0].roundId) && (
                    <WinBurst
                      key={race.rounds[0].roundId}
                      compact
                      amount={won}
                      onDone={() => setBursts((current) => current.filter((id) => id !== race.rounds[0].roundId))}
                    />
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      ) : (
        <div ref={grid} className="relative h-full p-1 sm:p-0">
          {stepping && <StepCatcher onStep={turnCard} />}
          {board(0).stage}
          <AnimatePresence>
            {played[0] && bursts.includes(played[0].rounds[0].roundId) && (
              <WinBurst key={played[0].rounds[0].roundId} amount={winnings} onDone={() => setBursts([])} />
            )}
          </AnimatePresence>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {phase === "done" && outcome ? played.map((race) => `${SUITS[race.outcome]} won`).join(", ") : ""}
      </p>
    </GameFrame>
  );
}

/** One pill for how to race: one race or four, and card by card on a tap, on their own, or fast. */
function RaceModes({
  quad,
  onQuad,
  pace,
  onPace,
  disabled,
}: {
  quad: boolean;
  onQuad(quad: boolean): void;
  pace: RacePace;
  onPace(pace: RacePace): void;
  disabled: boolean;
}) {
  const options: { id: RacePace; label: string; icon: React.ReactNode }[] = [
    { id: "step", label: "Step: turn every card yourself", icon: <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-3.9-1.9L4.5 16a1.6 1.6 0 0 1 2.4-2.1L9 16" /> },
    { id: "auto", label: "Auto", icon: <path d="M8 5.5v13l11-6.5z" /> },
    { id: "fast", label: "Fast: short races, no long win animations", icon: <path d="M4 6v12l8-6zM12 6v12l8-6z" /> },
  ];
  const segment = (on: boolean) => `grid h-7 place-items-center rounded-full transition disabled:opacity-50 ${on ? "bg-gold/20 text-gold-bright" : "text-muted hover:text-text"}`;
  return (
    <div className="flex items-center rounded-full border border-line bg-ink/60 p-0.5">
      <div role="radiogroup" aria-label="Races at once" className="flex">
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={quad === value}
            disabled={disabled}
            onClick={() => onQuad(value)}
            className={`${segment(quad === value)} px-2 text-xs font-semibold`}
          >
            {value ? "4×" : "1×"}
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-line" />
      <div role="radiogroup" aria-label="Race pace" className="flex">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={pace === option.id}
          aria-label={option.label}
          title={option.label}
          disabled={disabled}
          onClick={() => onPace(option.id)}
          className={`${segment(pace === option.id)} w-7`}
        >
          <svg viewBox="0 0 24 24" className="size-4" fill={option.id === "step" ? "none" : "currentColor"} stroke={option.id === "step" ? "currentColor" : "none"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {option.icon}
          </svg>
        </button>
      ))}
      </div>
    </div>
  );
}

/** In step pace, the whole board is one big button that turns the next card. */
function StepCatcher({ onStep }: { onStep(): void }) {
  return (
    <button type="button" aria-label="Turn the next card" onClick={onStep} className="absolute inset-0 z-30 cursor-pointer">
      <span className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto w-fit animate-pulse rounded-full bg-black/75 px-3 py-1 text-xs font-semibold text-gold-bright">
        Tap to turn the next card
      </span>
    </button>
  );
}

/** After four races: each race's win drops in and the sum counts up. A tap skips it. */
function WinTally({ wins, onDone }: { wins: number[]; onDone(): void }) {
  const total = sum(wins);
  const [shown, setShown] = useState(0);
  const close = useRef(onDone);
  useEffect(() => {
    close.current = onDone;
  });
  useEffect(() => {
    play("bigWin");
    const controls = animate(0, total, {
      duration: 0.6 + wins.length * 0.35,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => {
        setShown(Math.round(value));
        play("tick");
      },
    });
    const timer = window.setTimeout(() => close.current(), 1600 + wins.length * 450);
    return () => {
      controls.stop();
      window.clearTimeout(timer);
    };
  }, [total, wins.length]);
  return (
    <motion.button
      type="button"
      aria-label={`Total win ${formatTokenAmount(BigInt(total))}. Tap to close.`}
      onClick={onDone}
      className="absolute inset-0 z-40 grid place-items-center bg-black/55"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <span className="flex flex-col items-center gap-2 rounded-3xl border border-gold/40 bg-ink/90 px-7 py-5 shadow-2xl shadow-black/70">
        <span className="flex flex-wrap justify-center gap-1.5">
          {wins.map((won, index) => (
            <motion.span
              key={index}
              className="rounded-full border border-positive/40 bg-positive/10 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-positive"
              initial={{ opacity: 0, y: -10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.15 + index * 0.35 }}
            >
              +{formatTokenAmount(BigInt(won))}
            </motion.span>
          ))}
        </span>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.3em] text-gold-bright">Total win</span>
        <span className="text-gold-gradient text-4xl font-bold tabular-nums">+{formatTokenAmount(BigInt(shown))}</span>
        <span className="text-[0.65rem] text-faint">Tap to close</span>
      </span>
    </motion.button>
  );
}

/** The chip the next tap places: − and + around it. */
function ChipStepper({
  chip,
  bets,
  onStep,
  disabled,
  affordable,
}: {
  chip: number;
  bets: { min: number; max: number; step: number };
  onStep(direction: 1 | -1): void;
  disabled: boolean;
  affordable: boolean;
}) {
  const button = "grid size-7 place-items-center rounded-lg border border-line bg-white/[0.03] text-lg leading-none transition enabled:active:scale-95 disabled:opacity-30";
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Chip">
      <button type="button" aria-label="Smaller chip" className={button} onClick={() => onStep(-1)} disabled={disabled || chip <= bets.min}>
        −
      </button>
      <span
        className={`grid h-7 min-w-11 place-items-center rounded-full border-2 border-dashed border-[#1a1204]/40 bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] px-2 text-xs font-bold tabular-nums text-[#1a1204] shadow-md ${
          affordable ? "" : "opacity-50"
        }`}
        aria-live="polite"
      >
        {formatTokenAmount(BigInt(chip))}
      </span>
      <button type="button" aria-label="Bigger chip" className={button} onClick={() => onStep(1)} disabled={disabled || chip >= bets.max}>
        +
      </button>
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick(): void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-7 place-items-center rounded-lg border border-line text-muted transition hover:border-gold/40 hover:text-text disabled:opacity-30"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}
