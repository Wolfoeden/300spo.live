"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GAME_COPY, HORSES, cosmetic, formatMultiplier, isKnownGame, type GameId } from "@/lib/game/catalog";
import { formatTokenAmount } from "@/lib/format";
import { Spinner } from "../icons";

export type ArenaGame = { id: string; name: string; outcomes: number; payoutBps: number; enabled: boolean };
export type PlayResult = { roundId: number; game: string; bet: number; choice: number; outcome: number; win: boolean; payout: number; balance: number };

type Props = {
  games: ArenaGame[];
  bets: { min: number; max: number; step: number };
  balance: number;
  enabled: boolean;
  play(game: string, bet: number, choice: number): Promise<PlayResult>;
  onSettled(): void;
};

const ANIMATION_MS: Record<GameId, number> = { "coin-flip": 1900, "horse-race": 4300, "xerxes-vs-robot": 3600 };

export function Arena({ games, bets, balance, enabled, play, onSettled }: Props) {
  const playable = games.filter((game) => game.enabled && isKnownGame(game.id));
  const [gameId, setGameId] = useState<GameId>((playable[0]?.id as GameId) ?? "coin-flip");
  const game = playable.find((entry) => entry.id === gameId) ?? playable[0];
  const [bet, setBet] = useState(bets.min);
  const [choice, setChoice] = useState<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "waiting" | "animating" | "done">("idle");
  const [result, setResult] = useState<PlayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  const amounts = useMemo(() => {
    const list: number[] = [];
    for (let amount = bets.min; amount <= bets.max; amount += bets.step) list.push(amount);
    return list;
  }, [bets]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  if (!game) return null;
  const copy = GAME_COPY[game.id as GameId];
  const busy = phase === "waiting" || phase === "animating";
  const canPlay = enabled && choice !== null && bet <= balance && !busy;

  const switchGame = (id: GameId) => {
    if (busy) return;
    setGameId(id);
    setChoice(null);
    setResult(null);
    setPhase("idle");
    setError(null);
  };

  const start = async () => {
    if (choice === null) return;
    setError(null);
    setResult(null);
    setPhase("waiting");
    try {
      const outcome = await play(game.id, bet, choice);
      setResult(outcome);
      setPhase("animating");
      // On phones the stage sits above the controls; bring it into view for the show.
      const box = stage.current?.getBoundingClientRect();
      if (box && (box.top < 0 || box.bottom > window.innerHeight)) stage.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      timer.current = window.setTimeout(() => {
        setPhase("done");
        onSettled();
      }, reduce ? 200 : ANIMATION_MS[game.id as GameId]);
    } catch (cause) {
      setPhase("idle");
      setError(cause instanceof Error ? cause.message : "The bet could not be placed.");
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-night lg:col-span-2">
      <div aria-hidden="true" className="grid-backdrop absolute inset-0 opacity-50" />
      <div className="relative">
        <div className="flex gap-1 overflow-x-auto border-b border-line p-2" role="tablist" aria-label="Games">
          {playable.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={entry.id === game.id}
              onClick={() => switchGame(entry.id as GameId)}
              className={`shrink-0 rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                entry.id === game.id ? "bg-gold/15 text-gold-bright" : "text-muted hover:bg-white/5 hover:text-text"
              }`}
            >
              {GAME_COPY[entry.id as GameId].title}
              <span className="ml-2 font-mono text-xs text-faint">{formatMultiplier(entry.payoutBps)}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div ref={stage} className="min-h-[18rem]">
            {game.id === "coin-flip" && <CoinStage result={phase === "idle" ? null : result} />}
            {game.id === "horse-race" && <RaceStage result={phase === "idle" ? null : result} picked={choice} />}
            {game.id === "xerxes-vs-robot" && <DuelStage result={phase === "idle" ? null : result} />}
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-2xl font-semibold">{copy.title}</h2>
              <p className="mt-1 text-sm text-muted">
                {copy.tagline} A correct pick pays {formatMultiplier(game.payoutBps)} your bet.
              </p>
            </div>

            <fieldset>
              <legend className="mb-2 text-xs text-faint">Your pick</legend>
              <div className={`grid gap-2 ${copy.choices.length > 2 ? "grid-cols-1" : "grid-cols-2"}`}>
                {copy.choices.map((label, index) => (
                  <button
                    key={label}
                    onClick={() => setChoice(index)}
                    disabled={busy}
                    aria-pressed={choice === index}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                      choice === index ? "border-gold bg-gold/10 text-text" : "border-line text-muted hover:border-gold/40 hover:text-text"
                    }`}
                  >
                    {game.id === "horse-race" && <Silk index={index} small />}
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-xs text-faint">Bet (tokens)</legend>
              <div className="flex flex-wrap gap-2">
                {amounts.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setBet(amount)}
                    disabled={busy || amount > balance}
                    aria-pressed={bet === amount}
                    className={`rounded-full border px-3 py-1.5 text-xs tabular-nums transition disabled:opacity-40 ${
                      bet === amount ? "border-gold bg-gold/15 text-gold-bright" : "border-line text-muted hover:border-gold/40"
                    }`}
                  >
                    {formatTokenAmount(BigInt(amount))}
                  </button>
                ))}
              </div>
            </fieldset>

            <button className="btn btn-gold w-full" onClick={start} disabled={!canPlay}>
              {phase === "waiting" && <Spinner size={16} />}
              {choice === null
                ? "Pick a winner first"
                : bet > balance
                  ? "Not enough game balance"
                  : `Bet ${formatTokenAmount(BigInt(bet))} on ${copy.choices[choice]}`}
            </button>

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
                    {result.win ? `Your ${formatTokenAmount(BigInt(result.bet))} bet on ${copy.choices[result.choice]} paid ${formatMultiplier(game.payoutBps)}.` : `Your ${formatTokenAmount(BigInt(result.bet))} bet on ${copy.choices[result.choice]} is gone.`}{" "}
                    Balance: {formatTokenAmount(BigInt(result.balance))}.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
            {error && <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
            {!enabled && <p className="text-sm text-warning">Games are paused right now.</p>}
          </div>
        </div>
      </div>
    </section>
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

// ---------------------------------------------------------------- horse race

export function Silk({ index, small }: { index: number; small?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-lg font-mono font-bold text-white shadow-inner ${small ? "size-7 text-xs" : "size-9 text-sm"}`}
      style={{ background: `linear-gradient(135deg, ${HORSES[index].color}, ${HORSES[index].color}99)` }}
    >
      {index + 1}
    </span>
  );
}

function RaceStage({ result, picked }: { result: PlayResult | null; picked: number | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full flex-col justify-center gap-2 py-2">
      {HORSES.map((horse, index) => {
        const winner = result?.outcome === index;
        // The winner crosses first; the others finish 0.2–1.0 s later. Losers may lead at
        // half-time and the winner comes from behind (cosmetic, derived from the round id).
        const duration = result ? (winner ? 3.4 : 3.6 + cosmetic(result.roundId, index) * 0.8) : 0;
        const halfway = result ? (winner ? 38 + cosmetic(result.roundId, 10) * 10 : 45 + cosmetic(result.roundId, index + 20) * 30) : 0;
        return (
          <div key={horse.name} className={`relative h-12 rounded-xl border ${picked === index ? "border-gold/50" : "border-line"} bg-white/[0.02]`}>
            <div aria-hidden="true" className="absolute inset-y-0 right-10 w-1.5 bg-[repeating-linear-gradient(0deg,#fff_0_6px,#111_6px_12px)] opacity-60" />
            <span className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 text-xs text-faint">{horse.name}</span>
            {/* The track ends just past the finish line; runners move 0% → 100% of it (same unit, so it animates). */}
            <div className="absolute inset-y-0 left-2 right-[4.25rem]">
              <motion.div
                key={result?.roundId ?? "start"}
                className="absolute top-1/2 flex -translate-y-1/2 items-center"
                initial={{ left: "0%" }}
                animate={{ left: result ? ["0%", `${halfway}%`, "100%"] : "0%" }}
                transition={{ duration: reduce ? 0 : duration, times: [0, 0.55, 1], ease: ["easeIn", "easeOut"] }}
              >
                <motion.span
                  animate={result ? { y: [0, -3, 0] } : { y: 0 }}
                  transition={{ duration: 0.35, repeat: result ? Math.round(duration / 0.35) : 0 }}
                >
                  <Silk index={index} />
                </motion.span>
              </motion.div>
            </div>
          </div>
        );
      })}
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

function RobotFace() {
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
