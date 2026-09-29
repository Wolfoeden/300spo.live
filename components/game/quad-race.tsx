"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { SUIT_COLORS, SUIT_SYMBOLS, SUITS } from "@/lib/game/card-race";
import { formatMultiplier } from "@/lib/game/catalog";
import { Spinner } from "../icons";
import type { ArenaGame, PlayResult, RaceTicket } from "./arena";
import { WinBurst } from "./arena-effects";
import { CardRaceStage, raceEvents, raceTimeline, type RaceDeal } from "./card-race-stage";
import { BetStepper, GameFrame, Kbd, stepBet, useGameKeys } from "./game-frame";

export const BOARDS = 4;
export type RaceDeals = { nonce: number; serverSeedHash: string; deals: RaceDeal[] };
export type RaceRound = Omit<PlayResult, "balance">;
export type MultiRaceResult = { results: (RaceRound | null)[]; balance: number };

type Props = {
  game: ArenaGame;
  bets: { min: number; max: number; step: number };
  balance: number;
  enabled: boolean;
  loadRaces(count: number): Promise<RaceDeals>;
  playRaces(bet: number, choices: number[], ticket: RaceTicket): Promise<MultiRaceResult>;
  dealVersion: number;
  onSettled(): void;
  onBack(): void;
  toolbar?: React.ReactNode;
};

const empty = (): (number | null)[] => Array.from({ length: BOARDS }, () => null);

/** Four horse races at once, like the four games of a "Pharao" machine. */
export function QuadRace({ game, bets, balance, enabled, loadRaces, playRaces, dealVersion, onSettled, onBack, toolbar }: Props) {
  const reduce = useReducedMotion();
  const [bet, setBet] = useState(bets.min);
  const [picks, setPicks] = useState(empty);
  const [phase, setPhase] = useState<"idle" | "waiting" | "animating" | "done">("idle");
  const [outcome, setOutcome] = useState<MultiRaceResult | null>(null);
  const [deals, setDeals] = useState<RaceDeals | null>(null);
  const [dealKey, setDealKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  // The board the number keys pick for; it moves on after each pick.
  const [active, setActive] = useState(0);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    let active = true;
    loadRaces(BOARDS).then(
      (loaded) => active && setDeals(loaded),
      () => active && setError("Could not deal the races. Reload the page."),
    );
    return () => {
      active = false;
    };
  }, [loadRaces, dealKey, dealVersion]);

  const [bursts, setBursts] = useState<number[]>([]);
  const finish = useCallback(
    (result: MultiRaceResult) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      setPhase("done");
      setBursts(result.results.filter((round) => round?.win).map((round) => round!.roundId));
      setPicks(empty());
      setDealKey((key) => key + 1);
      onSettled();
    },
    [onSettled],
  );

  const busy = phase === "waiting" || phase === "animating";
  const picked = picks.filter((choice) => choice !== null).length;
  const total = bet * picked;
  const oddsOf = (board: number, suit: number) => deals?.deals[board]?.odds[suit] ?? 0;
  const canStart =
    enabled && !busy && !!deals && picked > 0 && total <= balance && picks.every((choice, board) => choice === null || oddsOf(board, choice) > 0);
  const showResult = phase === "animating" || phase === "done";
  const shownBalance = busy ? balance - total : phase === "done" && outcome ? outcome.balance : balance;
  const won = outcome?.results.filter((round): round is RaceRound => !!round && round.win) ?? [];
  const played = outcome?.results.filter((round): round is RaceRound => !!round) ?? [];
  const winnings = won.reduce((sum, round) => sum + round.payout, 0);

  const pick = (board: number, suit: number) => {
    if (busy) return;
    if (phase === "done") {
      // The finished races stay on screen until the player starts picking for the next ones.
      setPhase("idle");
      setOutcome(null);
      setPicks(empty().map((_, index) => (index === board ? suit : null)));
      return;
    }
    setPicks((current) => current.map((choice, index) => (index === board ? (choice === suit ? null : suit) : choice)));
  };

  const pickByKey = (suit: number) => {
    if (busy || oddsOf(active, suit) === 0) return;
    pick(active, suit);
    setActive((board) => (board + 1) % BOARDS);
  };
  const canSkip = phase === "animating" && !!outcome;
  const skip = () => outcome && finish(outcome);

  useGameKeys({
    "1": () => pickByKey(0),
    "2": () => pickByKey(1),
    "3": () => pickByKey(2),
    "4": () => pickByKey(3),
    left: () => setActive((board) => (board + BOARDS - 1) % BOARDS),
    right: () => setActive((board) => (board + 1) % BOARDS),
    backspace: () => !busy && setPicks((current) => current.map((choice, index) => (index === active ? null : choice))),
    up: () => !busy && setBet(stepBet(bets, bet, 1)),
    down: () => !busy && setBet(stepBet(bets, bet, -1)),
    plus: () => !busy && setBet(stepBet(bets, bet, 1)),
    minus: () => !busy && setBet(stepBet(bets, bet, -1)),
    enter: () => canStart && void start(),
    space: () => canStart && void start(),
    s: canSkip && skip,
  });

  const start = async () => {
    if (!deals || !canStart) return;
    setError(null);
    setOutcome(null);
    setBursts([]);
    setPhase("waiting");
    try {
      const result = await playRaces(
        bet,
        picks.map((choice) => choice ?? -1),
        { nonce: deals.nonce, serverSeedHash: deals.serverSeedHash },
      );
      setOutcome(result);
      setPhase("animating");
      const box = grid.current?.getBoundingClientRect();
      if (box && (box.top < 0 || box.top > window.innerHeight * 0.5)) grid.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      const longest = Math.max(...result.results.map((round) => (round?.race ? raceTimeline(raceEvents(round.race)).total : 0)));
      timer.current = window.setTimeout(() => finish(result), reduce ? 200 : longest);
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "The races could not start.");
      setDealKey((key) => key + 1);
    }
  };

  return (
    <GameFrame gameId="card-race" payoutBps={game.payoutBps} balance={shownBalance} onBack={onBack} toolbar={toolbar}>
      <div className="p-3 sm:p-5">
        <div ref={grid} className="grid scroll-mt-24 grid-cols-2 gap-2 sm:gap-3">
          {Array.from({ length: BOARDS }, (_, board) => {
            const round = showResult ? (outcome?.results[board] ?? null) : null;
            const choice = showResult && round ? round.choice : picks[board];
            return (
              <div
                key={board}
                className={`relative min-w-0 rounded-2xl border bg-ink/50 p-1.5 transition sm:p-3 ${
                  active === board && !busy ? "border-gold/50 pointer-fine:shadow-[0_0_0_1px_rgba(233,180,76,0.25)]" : "border-line"
                }`}
                onPointerDown={() => setActive(board)}
              >
                <div className="mb-1 flex items-center justify-between gap-1 px-0.5 text-[0.65rem] sm:mb-2 sm:text-sm">
                  <span className="font-mono uppercase tracking-[0.14em] text-faint">Race {board + 1}</span>
                  {choice !== null ? (
                    <span className="truncate font-semibold" style={{ color: SUIT_COLORS[choice] }}>
                      {SUIT_SYMBOLS[choice]} {formatMultiplier(round?.race?.odds[choice] ?? oddsOf(board, choice))}
                    </span>
                  ) : (
                    <span className="text-faint">{showResult ? "skipped" : "tap a lane"}</span>
                  )}
                </div>
                <CardRaceStage
                  compact
                  deal={deals?.deals[board] ?? null}
                  result={round?.race ? { roundId: round.roundId, outcome: round.outcome, race: round.race } : null}
                  instant={phase === "done"}
                  picked={choice}
                  onPick={(suit) => pick(board, suit)}
                  disabled={busy}
                />
                <AnimatePresence>
                  {phase === "done" && round && bursts.includes(round.roundId) && (
                    <WinBurst
                      key={round.roundId}
                      compact
                      amount={round.payout}
                      onDone={() => setBursts((current) => current.filter((id) => id !== round.roundId))}
                    />
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:items-end">
          <BetStepper
            bets={bets}
            bet={bet}
            onChange={setBet}
            disabled={busy}
            label="Bet per race"
            affordable={(amount) => amount * Math.max(1, picked) <= balance}
          />
          <div className="flex flex-col gap-2">
            <button className="btn btn-gold w-full !py-4 text-base" onClick={start} disabled={!canStart}>
              {phase === "waiting" && <Spinner size={16} />}
              {picked === 0
                ? "Pick a lane in any race"
                : total > balance
                  ? "Not enough game balance"
                  : `Start ${picked} race${picked === 1 ? "" : "s"} · ${formatTokenAmount(BigInt(total))}`}
              {canStart && <Kbd>Enter</Kbd>}
            </button>
            {canSkip ? (
              <button className="inline-flex items-center gap-2 self-center text-xs text-faint hover:text-text" onClick={skip}>
                Skip to the finish <Kbd>S</Kbd>
              </button>
            ) : (
              <p className="hidden items-center justify-center gap-1.5 text-xs text-faint pointer-fine:flex">
                <Kbd>←</Kbd>
                <Kbd>→</Kbd> race · <Kbd>1</Kbd>–<Kbd>4</Kbd> lane · <Kbd>⌫</Kbd> clear
              </p>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {phase === "done" && outcome && (
            <motion.div
              key={played.map((round) => round.roundId).join("-")}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border p-4 ${
                winnings > 0 ? "border-positive/40 bg-positive/10" : "border-line bg-white/[0.03]"
              }`}
            >
              <p className={`text-lg font-semibold ${winnings > 0 ? "text-positive" : "text-text"}`}>
                {winnings > 0 ? `You won ${formatTokenAmount(BigInt(winnings))} tokens` : "No win this time"}
              </p>
              <p className="text-sm text-muted">
                {won.length} of {played.length} race{played.length === 1 ? "" : "s"} won
                {played.length > 0 && ` · winners ${played.map((round) => SUIT_SYMBOLS[round.outcome]).join(" ")}`} · balance{" "}
                {formatTokenAmount(BigInt(outcome.balance))}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        {error && <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
        {!enabled && <p className="mt-4 text-sm text-warning">Games are paused right now.</p>}
        <p className="sr-only" aria-live="polite">
          {phase === "done" && outcome ? played.map((round) => `${SUITS[round.outcome]} won`).join(", ") : ""}
        </p>
      </div>
    </GameFrame>
  );
}
