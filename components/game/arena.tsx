"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_COPY, cosmetic, formatMultiplier, type GameId } from "@/lib/game/catalog";
import { formatTokenAmount } from "@/lib/format";
import { SUIT_COLORS, SUIT_SYMBOLS } from "@/lib/game/card-race";
import { Spinner } from "../icons";
import { WinBurst } from "./arena-effects";
import { CardRaceStage, raceEvents, raceTimeline, type RacePreview } from "./card-race-stage";
import { BetChips, GameFrame } from "./game-frame";

export type ArenaGame = { id: string; name: string; kind: "pick" | "race"; outcomes: number; payoutBps: number; enabled: boolean };
export type PlayResult = {
  roundId: number;
  game: string;
  bet: number;
  choice: number;
  outcome: number;
  win: boolean;
  payout: number;
  balance: number;
  race?: { track: number[]; draws: number[]; odds: number[] };
};
export type RaceTicket = { nonce: number; serverSeedHash: string };

type Props = {
  game: ArenaGame;
  bets: { min: number; max: number; step: number };
  balance: number;
  enabled: boolean;
  play(game: string, bet: number, choice: number, race?: RaceTicket): Promise<PlayResult>;
  loadRace(): Promise<RacePreview>;
  /** Changes when the seed changes, so the race is dealt again. */
  dealVersion: number;
  onSettled(): void;
  onBack(): void;
  /** Extra controls in the game header (the 1×/4× switch of the horse race). */
  toolbar?: React.ReactNode;
};

const ANIMATION_MS: Partial<Record<GameId, number>> = { "coin-flip": 1900, "xerxes-vs-robot": 3600 };

const animationMs = (result: PlayResult) => (result.race ? raceTimeline(raceEvents(result.race)).total : (ANIMATION_MS[result.game as GameId] ?? 2000));

/** One game at a time: its stage on the left, pick, bet and result on the right. */
export function Arena({ game, bets, balance, enabled, play, loadRace, dealVersion, onSettled, onBack, toolbar }: Props) {
  const [bet, setBet] = useState(bets.min);
  const [choice, setChoice] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "waiting" | "animating" | "done">("idle");
  const [result, setResult] = useState<PlayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RacePreview | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [burst, setBurst] = useState<{ roundId: number; amount: number } | null>(null);
  const timer = useRef<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const isRace = game.kind === "race";

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  // The next race is dealt by the server; load it whenever the race tab needs a fresh deal.
  useEffect(() => {
    if (!isRace) return;
    let active = true;
    loadRace().then(
      (loaded) => active && setPreview(loaded),
      () => active && setError("Could not deal the next race. Reload the page."),
    );
    return () => {
      active = false;
    };
  }, [isRace, loadRace, previewKey, dealVersion]);

  const finish = useCallback(
    (outcome: PlayResult) => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      setPhase("done");
      if (outcome.win) setBurst({ roundId: outcome.roundId, amount: outcome.payout });
      // A race is followed by a new deal: the player picks again after seeing its track.
      if (isRace) setChoice(null);
      setPreviewKey((key) => key + 1);
      onSettled();
    },
    [isRace, onSettled],
  );

  const copy = GAME_COPY[game.id as GameId];
  const busy = phase === "waiting" || phase === "animating";
  const odds = isRace ? (preview?.odds ?? null) : null;
  const pickOdds = (index: number) => (isRace ? (odds?.[index] ?? 0) : game.payoutBps);
  const canPlay = enabled && choice !== null && bet <= balance && !busy && (!isRace || (!!preview && pickOdds(choice) > 0));
  // After a race the board keeps the finished race until the player picks for the next one.
  const showResult = phase !== "idle";
  // The in-game balance drops by the bet at once and shows the payout only when the round has played out.
  const shownBalance = busy ? balance - bet : phase === "done" && result ? result.balance : balance;

  const pick = (index: number) => {
    if (busy) return;
    setChoice(index);
    setBurst(null);
    if (isRace && phase === "done") setPhase("idle");
  };

  const start = async () => {
    if (choice === null) return;
    setError(null);
    setResult(null);
    setBurst(null);
    setPhase("waiting");
    try {
      const outcome = await play(game.id, bet, choice, isRace && preview ? { nonce: preview.nonce, serverSeedHash: preview.serverSeedHash } : undefined);
      setResult(outcome);
      setPhase("animating");
      // On phones the stage sits above the controls; bring it into view for the show.
      const box = stage.current?.getBoundingClientRect();
      if (box && (box.top < 0 || box.bottom > window.innerHeight)) stage.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      timer.current = window.setTimeout(() => finish(outcome), reduce ? 200 : animationMs(outcome));
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "The bet could not be placed.");
      if (isRace) setPreviewKey((key) => key + 1);
    }
  };

  const multiplier = (index: number) => formatMultiplier(pickOdds(index));

  return (
    <GameFrame gameId={game.id as GameId} payoutBps={game.payoutBps} balance={shownBalance} onBack={onBack} toolbar={toolbar}>
        <div className="grid grid-cols-1 gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div ref={stage} className="relative min-h-[18rem]">
            <AnimatePresence>{burst && <WinBurst key={burst.roundId} amount={burst.amount} onDone={() => setBurst(null)} />}</AnimatePresence>
            {game.id === "coin-flip" && <CoinStage result={showResult ? result : null} />}
            {game.id === "card-race" && (
              <CardRaceStage
                deal={preview}
                result={showResult && result?.race ? { roundId: result.roundId, outcome: result.outcome, race: result.race } : null}
                instant={phase === "done"}
                picked={choice}
                onPick={pick}
                disabled={busy}
                canStart={canPlay}
                bet={bet}
                onStart={() => void start()}
              />
            )}
            {game.id === "xerxes-vs-robot" && <DuelStage result={showResult ? result : null} />}
          </div>

          <div className="flex flex-col gap-5">
            <fieldset>
              <legend className="mb-2 text-xs text-faint">Your pick</legend>
              <div className="grid grid-cols-2 gap-2">
                {copy.choices.map((label, index) => (
                  <button
                    key={label}
                    onClick={() => pick(index)}
                    disabled={busy || (isRace && pickOdds(index) === 0)}
                    aria-pressed={choice === index}
                    className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition disabled:opacity-40 ${
                      choice === index ? "border-gold bg-gold/10 text-text" : "border-line text-muted enabled:hover:border-gold/40 enabled:hover:text-text"
                    }`}
                  >
                    {isRace && (
                      <span className="text-base leading-none" style={{ color: SUIT_COLORS[index] }}>
                        {SUIT_SYMBOLS[index]}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {isRace && <span className="font-mono text-xs text-gold-bright">{odds ? (pickOdds(index) ? multiplier(index) : "—") : "…"}</span>}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-xs text-faint">Bet (tokens)</legend>
              <BetChips bets={bets} bet={bet} onChange={setBet} disabled={busy} affordable={(amount) => amount <= balance} />
            </fieldset>

            <button className="btn btn-gold w-full" onClick={start} disabled={!canPlay}>
              {phase === "waiting" && <Spinner size={16} />}
              {choice === null
                ? "Pick a winner first"
                : bet > balance
                  ? "Not enough game balance"
                  : `Bet ${formatTokenAmount(BigInt(bet))} on ${copy.choices[choice]}${isRace && odds ? ` · ${multiplier(choice)}` : ""}`}
            </button>
            {phase === "animating" && isRace && (
              <button className="-mt-3 self-center text-xs text-faint underline-offset-4 hover:text-text hover:underline" onClick={() => result && finish(result)}>
                Skip to the finish
              </button>
            )}

            <AnimatePresence mode="wait">
              {phase === "done" && result && (
                <motion.div
                  key={result.roundId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`rounded-2xl border p-4 ${result.win ? "border-positive/40 bg-positive/10" : "border-line bg-white/[0.03]"}`}
                >
                  <p className={`text-lg font-semibold ${result.win ? "text-positive" : "text-text"}`}>
                    {result.win ? `You won ${formatTokenAmount(BigInt(result.payout))} tokens!` : `${copy.choices[result.outcome]} wins.`}
                  </p>
                  <p className="text-sm text-muted">
                    {result.win
                      ? `Your ${formatTokenAmount(BigInt(result.bet))} bet on ${copy.choices[result.choice]} paid ${formatMultiplier(result.race ? result.race.odds[result.choice] : game.payoutBps)}.`
                      : `Your ${formatTokenAmount(BigInt(result.bet))} bet on ${copy.choices[result.choice]} is gone.`}{" "}
                    Balance: {formatTokenAmount(BigInt(result.balance))}.
                  </p>
                  {isRace && <p className="mt-1 text-xs text-faint">Pick an ace to deal the next race.</p>}
                </motion.div>
              )}
            </AnimatePresence>
            {error && <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
            {!enabled && <p className="text-sm text-warning">Games are paused right now.</p>}
          </div>
        </div>
    </GameFrame>
  );
}

// ---------------------------------------------------------------- coin flip

function CoinStage({ result }: { result: PlayResult | null }) {
  const [rotation, setRotation] = useState(0);
  const [lastRound, setLastRound] = useState<number | null>(null);
  // Each new result spins five more turns and lands on its side (0 = Xerxes, 1 = 300).
  if (result && result.roundId !== lastRound) {
    setLastRound(result.roundId);
    setRotation(Math.ceil(rotation / 360) * 360 + 1800 + (result.outcome === 1 ? 180 : 0));
  }
  return (
    <div className="grid h-full place-items-center py-6 [perspective:1000px]">
      <motion.div
        className="relative size-52 sm:size-60"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: rotation }}
        transition={{ duration: 1.8, ease: [0.2, 0.75, 0.25, 1] }}
      >
        <div className="absolute inset-0 rounded-full [backface-visibility:hidden]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/300-logo.jpg" alt="Xerxes side" className="size-full rounded-full ring-2 ring-gold-bright/60 shadow-[0_30px_80px_-20px_rgba(233,180,76,0.6)]" />
        </div>
        <div className="absolute inset-0 grid place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffe7a8,#e9b44c_45%,#a8691c)] ring-2 ring-gold-bright/60 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <span className="text-6xl font-black tracking-tight text-[#2a1a03]">300</span>
        </div>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------- Xerxes vs robot

type Strike = { attacker: 0 | 1; damage: number };

/** A cosmetic fight script in which `winner` lands the final blow. */
const fightScript = (roundId: number, winner: number): Strike[] => {
  const hp = [100, 100];
  const strikes: Strike[] = [];
  for (let i = 0; i < 5; i += 1) {
    const attacker = (i % 2 === 0 ? 1 - winner : winner) as 0 | 1;
    const damage = 12 + Math.round(cosmetic(roundId, i) * 18);
    hp[1 - attacker] = Math.max(attacker === winner ? 5 : 15, hp[1 - attacker] - damage);
    strikes.push({ attacker, damage });
  }
  strikes.push({ attacker: winner as 0 | 1, damage: 100 });
  return strikes;
};

function DuelStage({ result }: { result: PlayResult | null }) {
  const [step, setStep] = useState(-1);
  const [round, setRound] = useState<number | null>(null);
  const script = useMemo(() => (result ? fightScript(result.roundId, result.outcome) : []), [result]);
  if (result && result.roundId !== round) {
    setRound(result.roundId);
    setStep(-1);
  }

  useEffect(() => {
    if (!result) return;
    const timers = script.map((_, index) => window.setTimeout(() => setStep(index), 450 + index * 500));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [result, script]);

  const hp = [100, 100];
  for (let i = 0; i <= step && i < script.length; i += 1) {
    const { attacker, damage } = script[i];
    hp[1 - attacker] = Math.max(0, hp[1 - attacker] - damage);
  }
  const current = step >= 0 ? script[step] : null;
  const finished = result !== null && step === script.length - 1;

  return (
    <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-3 py-6">
      <Fighter name="Xerxes" hp={hp[0]} striking={current?.attacker === 0} hit={current?.attacker === 1} knockedOut={finished && result?.outcome === 1} side="left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/300-logo.jpg" alt="" className="size-full rounded-full object-cover" />
      </Fighter>
      <span className="font-mono text-sm text-faint">VS</span>
      <Fighter name="AI robot" hp={hp[1]} striking={current?.attacker === 1} hit={current?.attacker === 0} knockedOut={finished && result?.outcome === 0} side="right">
        <RobotFace />
      </Fighter>
    </div>
  );
}

function Fighter({
  name,
  hp,
  striking,
  hit,
  knockedOut,
  side,
  children,
}: {
  name: string;
  hp: number;
  striking: boolean;
  hit: boolean;
  knockedOut: boolean;
  side: "left" | "right";
  children: React.ReactNode;
}) {
  const lunge = side === "left" ? 24 : -24;
  return (
    <div className="flex flex-col items-center gap-3">
      <motion.div
        className={`relative size-28 rounded-full p-1 sm:size-36 ${knockedOut ? "grayscale" : ""}`}
        animate={{ x: striking ? [0, lunge, 0] : hit ? [0, -lunge / 3, 0] : 0, opacity: knockedOut ? 0.45 : 1 }}
        transition={{ duration: 0.35 }}
        style={{ boxShadow: hit ? "0 0 0 3px rgba(255,107,107,0.7)" : "0 0 0 2px rgba(233,180,76,0.35)", borderRadius: "9999px" }}
      >
        {children}
        {knockedOut && <span className="absolute inset-0 grid place-items-center text-2xl font-black text-danger">K.O.</span>}
      </motion.div>
      <p className="text-sm font-semibold">{name}</p>
      <div className="h-2 w-28 overflow-hidden rounded-full bg-white/10 sm:w-36">
        <motion.div className={`h-full ${hp > 30 ? "bg-positive" : "bg-danger"}`} animate={{ width: `${hp}%` }} transition={{ duration: 0.3 }} />
      </div>
    </div>
  );
}

export function RobotFace() {
  return (
    <svg viewBox="0 0 120 120" className="size-full rounded-full bg-[radial-gradient(circle_at_40%_30%,#2b3440,#0d1117)]" aria-hidden="true">
      <line x1="60" y1="14" x2="60" y2="30" stroke="#8fd3ff" strokeWidth="3" />
      <circle cx="60" cy="12" r="5" fill="#8fd3ff" />
      <rect x="28" y="30" width="64" height="54" rx="14" fill="#1b232d" stroke="#8fd3ff" strokeWidth="2.5" />
      <rect x="38" y="46" width="16" height="10" rx="3" fill="#8fd3ff" />
      <rect x="66" y="46" width="16" height="10" rx="3" fill="#8fd3ff" />
      <rect x="44" y="66" width="32" height="6" rx="3" fill="#3a4a5c" />
      <rect x="20" y="48" width="8" height="16" rx="3" fill="#3a4a5c" />
      <rect x="92" y="48" width="8" height="16" rx="3" fill="#3a4a5c" />
      <path d="M40 92 h40 l6 14 h-52 z" fill="#1b232d" stroke="#3a4a5c" strokeWidth="2" />
    </svg>
  );
}
