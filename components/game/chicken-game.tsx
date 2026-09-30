"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatTokenAmount } from "@/lib/format";
import { SUIT_COLORS } from "@/lib/game/card-race";
import { cosmetic, formatMultiplier } from "@/lib/game/catalog";
import { DIFFICULTIES, hitChance } from "@/lib/game/chicken";
import { Spinner } from "../icons";
import type { ArenaGame } from "./arena";
import { WinBurst } from "./arena-effects";
import { FinishProps, Skyline, StartProps, VEHICLE_SECONDS, Vehicle, laneVehicle } from "./chicken-scenery";
import { play } from "@/lib/sound";
import { CockFigure } from "./cock-figure";
import { GameFrame, Kbd, stepBet, useGameKeys, type GameToast } from "./game-frame";
import { GamePanel, useAutoRun, useStopWhenHidden, type AutoMode, type WalletPanels } from "./terminal";

export type ChickenRound = {
  id: number;
  bet: number;
  hazards: number;
  lanes: number;
  step: number;
  status: "open" | "lost" | "collected";
  payout: number;
  crashLane: number | null;
  multipliers: number[];
  balance?: number;
};
export type ChickenState = { open: ChickenRound | null; difficulties: { hazards: number; lanes: number; multipliers: number[] }[] };

type Props = {
  game: ArenaGame;
  bets: { min: number; max: number; step: number };
  balance: number;
  enabled: boolean;
  load(): Promise<ChickenState>;
  start(bet: number, hazards: number): Promise<ChickenRound>;
  step(round: number): Promise<ChickenRound>;
  collect(round: number): Promise<ChickenRound>;
  onSettled(): void;
  onBack(): void;
  wallet: WalletPanels;
};


const subscribeResize = (callback: () => void) => {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
};

/** Chicken: walk the blue cock across the road; collect before a car hits. */
export function ChickenGame({ game, bets, balance, enabled, load, start, step, collect, onSettled, onBack, wallet }: Props) {
  const reduce = useReducedMotion();
  const [config, setConfig] = useState<ChickenState | null>(null);
  const [round, setRound] = useState<ChickenRound | null>(null);
  const [hazards, setHazards] = useState<number>(DIFFICULTIES[0].hazards);
  const [bet, setBet] = useState(bets.min);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ id: number; amount: number } | null>(null);
  // Holding GO keeps the cock walking; it stops with the round (never starts the next bet by itself).
  const [auto, setAuto] = useState<AutoMode>("off");
  const [lastWin, setLastWin] = useState<number | null>(null);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [seenBalance, setSeenBalance] = useState(balance);
  if (balance !== seenBalance) {
    // A refreshed balance from the page replaces the one from the last response.
    setSeenBalance(balance);
    setLiveBalance(null);
  }

  // Resume an open round after a reload.
  useEffect(() => {
    let active = true;
    load().then(
      (loaded) => {
        if (!active) return;
        setConfig(loaded);
        if (loaded.open) {
          setRound(loaded.open);
          setHazards(loaded.open.hazards);
          setBet(loaded.open.bet);
        }
      },
      () => active && setError("Could not load the game. Reload the page."),
    );
    return () => {
      active = false;
    };
  }, [load]);

  const open = round?.status === "open";
  // A finished round stays on the road until the next GO or a new difficulty.
  const shown = round && (open || round.hazards === hazards) ? round : null;
  const difficulty = config?.difficulties.find((entry) => entry.hazards === hazards);
  const lanes = shown?.lanes ?? difficulty?.lanes ?? 0;
  const multipliers = shown?.multipliers ?? difficulty?.multipliers ?? [];
  const position = shown?.step ?? 0;
  const current = open && position > 0 ? multipliers[position - 1] : 0;
  const collectable = open && position > 0 ? Math.floor((round.bet * current) / 10000) : 0;
  const nextChance = open ? hitChance(round.hazards, position) : hitChance(hazards, 0);
  const shownBalance = liveBalance ?? balance;
  const canGo = enabled && !busy && !!config && (open || bet <= shownBalance);

  const settle = useCallback(
    (result: ChickenRound) => {
      if (result.balance !== undefined) setLiveBalance(result.balance);
      if (result.status === "collected" && result.payout > 0) {
        setBurst({ id: result.id, amount: result.payout });
        setLastWin(result.payout);
      }
      if (result.status !== "open") onSettled();
    },
    [onSettled],
  );

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    setError(null);
    setBurst(null);
    try {
      let active = open ? round : null;
      if (!active) {
        play("cluck");
        active = await start(bet, hazards);
        setRound(active);
        settle(active);
        // The stake is gone now; the page balance should show it, not only the chip.
        onSettled();
      }
      const next = await step(active.id);
      play(next.status === "lost" ? "crash" : "hop");
      setRound(next);
      settle(next);
      if (next.status !== "open") setAuto("off");
    } catch (cause) {
      setAuto("off");
      setError(cause instanceof Error ? cause.message : "The cock could not move.");
    } finally {
      setBusy(false);
    }
  };

  const take = async () => {
    if (!open || position < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await collect(round.id);
      setRound(result);
      settle(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not collect.");
    } finally {
      setBusy(false);
    }
  };

  const chooseDifficulty = (value: number) => {
    if (open || busy) return;
    setHazards(value);
    setBurst(null);
  };

  const betLocked = open || busy;
  const stopAuto = useCallback(() => setAuto("off"), []);
  useStopWhenHidden(auto, stopAuto);
  useAutoRun(auto, !busy && canGo, () => void go(), 350);
  useGameKeys({
    space: () => canGo && void go(),
    enter: () => canGo && void go(),
    right: () => canGo && void go(),
    c: () => open && position > 0 && !busy && void take(),
    ...Object.fromEntries(DIFFICULTIES.map((entry, index) => [String(index + 1), () => chooseDifficulty(entry.hazards)])),
    up: () => !betLocked && setBet(stepBet(bets, bet, 1)),
    down: () => !betLocked && setBet(stepBet(bets, bet, -1)),
    plus: () => !betLocked && setBet(stepBet(bets, bet, 1)),
    minus: () => !betLocked && setBet(stepBet(bets, bet, -1)),
  });

  const rules = (
    <>
      <span className="block">Each GO moves the blue cock one lane further and raises the multiplier. Collect whenever you like — if a car hits him, the bet is lost.</span>
      <span className="mt-2 block">
        The difficulty hides 1, 3, 5 or 10 cars among 25 cells; the multipliers are the fair price for surviving that many lanes. The last lane collects by
        itself.
      </span>
    </>
  );

  const prompt =
    auto !== "off"
      ? "Walking while you hold GO"
      : busy
        ? "Crossing…"
        : open
          ? `Collect ${formatTokenAmount(BigInt(collectable))} or risk the next lane`
          : bet > shownBalance
            ? "Not enough balance for this bet"
            : `Tap GO · car next lane ${(nextChance * 100).toFixed(nextChance < 0.1 ? 1 : 0)}%`;

  const toast: GameToast | null = error
    ? { id: `error-${error}`, text: error, tone: "error" }
    : shown && shown.status !== "open"
      ? shown.status === "collected"
        ? {
            id: shown.id,
            text: `+${formatTokenAmount(BigInt(shown.payout))} after ${shown.step} lane${shown.step === 1 ? "" : "s"} · ${formatMultiplier(multipliers[shown.step - 1])}`,
            tone: "win",
          }
        : { id: shown.id, text: `Hit on lane ${shown.step} · ${formatTokenAmount(BigInt(shown.bet))} lost`, tone: "info" }
      : !enabled
        ? { id: "paused", text: "Games are paused right now.", tone: "warn" }
        : null;

  const panel = (
    <GamePanel
      prompt={prompt}
      options={
        <div>
          <p className="mb-1.5 hidden items-center justify-between gap-2 text-[0.7rem] text-faint lg:flex">
            <span className="flex items-center gap-1.5">
              Difficulty
              <Kbd>1</Kbd>–<Kbd>4</Kbd>
            </span>
            <span>
              Car next lane <span className="font-semibold text-text">{(nextChance * 100).toFixed(nextChance < 0.1 ? 1 : 0)}%</span>
            </span>
          </p>
          <div className="grid grid-cols-4 gap-1 rounded-xl border border-line bg-ink/60 p-0.5">
            {DIFFICULTIES.map((entry) => (
              <button
                key={entry.hazards}
                type="button"
                onClick={() => chooseDifficulty(entry.hazards)}
                disabled={open || busy}
                aria-pressed={hazards === entry.hazards}
                className={`rounded-lg px-1 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed lg:py-2 ${
                  hazards === entry.hazards ? "bg-gold/20 text-gold-bright" : "text-muted enabled:hover:text-text"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      }
      bet={{ bets, bet, onChange: setBet, disabled: betLocked, affordable: (amount) => amount <= shownBalance || open }}
      play={{
        label: open ? `Next ${formatMultiplier(multipliers[position] ?? 0)}` : "Go",
        onPlay: () => void go(),
        playable: canGo,
        auto,
        onAuto: setAuto,
        lockable: false,
        tone: "green",
        kbd: canGo ? <Kbd>Space</Kbd> : null,
      }}
      side={
        open ? (
          <button
            type="button"
            onClick={take}
            disabled={position < 1 || busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-gold-bright),var(--color-gold))] px-2 font-bold leading-tight lg:min-h-14 lg:flex-col lg:gap-0 lg:rounded-2xl text-[#1a1204] shadow-[0_10px_30px_-12px_rgba(233,180,76,0.8)] transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5 text-[0.68rem] uppercase tracking-[0.12em] opacity-80">
              Collect <Kbd>C</Kbd>
            </span>
            <span className="text-base tabular-nums lg:text-xl">{formatTokenAmount(BigInt(collectable))}</span>
          </button>
        ) : undefined
      }
      lastWin={lastWin}
      balance={shownBalance}
      wallet={wallet}
    />
  );

  return (
    <GameFrame gameId="chicken" payoutBps={game.payoutBps} onBack={onBack} info={rules} panel={panel} toast={toast}>
      <div className="h-full overflow-hidden sm:rounded-2xl sm:border sm:border-line">
        <Road
          lanes={lanes}
          multipliers={multipliers}
          position={position}
          round={shown}
          reduce={!!reduce}
          burst={burst && shown?.id === burst.id ? burst : null}
          onBurstDone={() => setBurst(null)}
        />
      </div>
    </GameFrame>
  );
}

// ---------------------------------------------------------------- the road

/** Camera tuning: base pull (1/s) and top speed as road widths per second. */
const CAMERA = { pull: 2.6, speed: 3 };
const CAMERA_STEP = 1 / 240;

/**
 * The road camera has weight. It trails a single hop, speeds up while the cock runs
 * lane after lane so he stays near the middle, and coasts to a stop when he pauses:
 * a damped spring whose pull grows with the distance to the cock.
 */
function useTrailingCamera(scroller: React.RefObject<HTMLDivElement | null>, focus: number, reduce: boolean) {
  const camera = useRef({ x: 0, v: 0, goal: 0, frame: 0, last: 0 });

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const state = camera.current;
    state.goal = Math.min(Math.max(0, element.scrollWidth - element.clientWidth), Math.max(0, focus - element.clientWidth / 2));
    if (reduce) {
      element.scrollTo({ left: state.goal, behavior: "instant" });
      return;
    }
    // A running camera just takes the new goal and keeps its speed.
    if (state.frame) return;
    state.x = element.scrollLeft;
    state.v = 0;
    state.last = 0;
    const tick = (now: number) => {
      const dt = state.last ? Math.min(0.05, (now - state.last) / 1000) : 1 / 60;
      state.last = now;
      const half = element.clientWidth / 2 || 1;
      const top = element.clientWidth * CAMERA.speed;
      for (let left = dt; left > 1e-6; left -= CAMERA_STEP) {
        const h = Math.min(CAMERA_STEP, left);
        const error = state.goal - state.x;
        const far = Math.min(1.2, Math.abs(error) / half);
        const pull = CAMERA.pull * (1 + 2 * far + 6 * far * far);
        state.v = Math.max(-top, Math.min(top, state.v + (pull * pull * error - 2 * pull * state.v) * h));
        state.x += state.v * h;
      }
      if (Math.abs(state.goal - state.x) < 0.5 && Math.abs(state.v) < 4) {
        element.scrollTo({ left: state.goal, behavior: "instant" });
        state.frame = 0;
        return;
      }
      element.scrollTo({ left: state.x, behavior: "instant" });
      state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
  }, [scroller, focus, reduce]);

  // The player takes over as soon as they drag or wheel the road; the camera stops with the game.
  useEffect(() => {
    const element = scroller.current;
    const state = camera.current;
    const release = () => {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    };
    element?.addEventListener("pointerdown", release);
    element?.addEventListener("wheel", release, { passive: true });
    return () => {
      release();
      element?.removeEventListener("pointerdown", release);
      element?.removeEventListener("wheel", release);
    };
  }, [scroller]);
}

function Road({
  lanes,
  multipliers,
  position,
  round,
  reduce,
  burst,
  onBurstDone,
}: {
  lanes: number;
  multipliers: number[];
  position: number;
  round: ChickenRound | null;
  reduce: boolean;
  burst: { id: number; amount: number } | null;
  onBurstDone(): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const narrow = useSyncExternalStore(subscribeResize, () => window.innerWidth < 640, () => false);
  const lane = narrow ? 84 : 124;

  const lost = round?.status === "lost";
  const crashLane = lost ? round.step : null;
  const sidewalk = Math.round(lane * 1.1);
  const centerOf = (index: number) => (index === 0 ? sidewalk / 2 : sidewalk + (index - 0.5) * lane);

  useTrailingCamera(scroller, centerOf(position), reduce);

  // The panorama takes the top of the road; the cock and the plates stand in the middle of what is left.
  const road = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [width, setWidth] = useState(0);
  // The visible part of the road, for the win burst around the cock.
  const [view, setView] = useState(0);
  useEffect(() => {
    const element = road.current;
    const frame = scroller.current;
    if (!element || !frame) return;
    const observer = new ResizeObserver(() => {
      setHeight(element.clientHeight);
      setWidth(element.clientWidth);
      setView(frame.clientWidth);
    });
    observer.observe(element);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  const world = Math.max(sidewalk * 2 + lanes * lane, width);
  const band = Math.round(Math.min(170, Math.max(72, height * 0.26)));
  const middle = `calc(50% + ${band / 2}px)`;

  return (
    <div ref={scroller} className="relative h-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
      <div
        ref={road}
        className="relative h-full min-h-56 overflow-hidden bg-[linear-gradient(180deg,#1b1c20,#141518)]"
        style={{ width: sidewalk * 2 + lanes * lane, minWidth: "100%" }}
      >
        {/* start sidewalk: the cock waits here */}
        <div className="absolute inset-y-0 left-0 border-r-4 border-[#2c2d33] bg-[#232429]" style={{ width: sidewalk }}>
          <div className="absolute inset-x-0 bottom-7 flex justify-center opacity-90">
            <StartProps size={Math.round(lane * 0.55)} />
          </div>
          <span className="absolute inset-x-0 bottom-3 text-center font-mono text-[0.6rem] uppercase tracking-[0.2em] text-faint">Start</span>
        </div>

        {Array.from({ length: lanes }, (_, index) => {
          const number = index + 1;
          const passed = number < position || (number === position && !lost);
          const next = round?.status !== "lost" && round?.status !== "collected" && number === position + 1;
          const crash = number === crashLane;
          // Decorative traffic on lanes ahead; the crash lane gets its own car.
          const traffic = !crash && number > position + 1 && cosmetic(number, 3) > 0.45;
          const suit = number % 4;
          return (
            <div key={number} className="absolute inset-y-0 border-l-2 border-dashed border-gold/25" style={{ left: sidewalk + index * lane, width: lane }}>
              {traffic && (
                <div
                  aria-hidden="true"
                  className={reduce ? "hidden" : "absolute inset-x-0 top-0 h-full animate-drive"}
                  style={{
                    animationDuration: `${VEHICLE_SECONDS[laneVehicle(number)] * (0.8 + cosmetic(number, 5) * 0.5)}s`,
                    animationDelay: `-${cosmetic(number, 7) * 3}s`,
                  }}
                >
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                    <Vehicle kind={laneVehicle(number)} color={SUIT_COLORS[suit]} />
                  </div>
                </div>
              )}
              <LaneMarks lane={number} band={band} />
              {passed && (
                <motion.div
                  className="absolute inset-x-1"
                  style={{ top: band + 10 }}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <Barrier />
                </motion.div>
              )}
              {/* The cock stands on his own lane; its value is in the label under him. */}
              {(number !== position || crash) && (
                <div className="absolute inset-x-0 grid -translate-y-1/2 place-items-center" style={{ top: middle }}>
                  <Plate value={multipliers[index]} size={lane * 0.74} state={crash ? "crash" : passed ? "passed" : next ? "next" : "ahead"} />
                </div>
              )}
              {crash && <CrashCar token={lane * 1.08} middle={middle} />}
            </div>
          );
        })}

        {/* finish sidewalk */}
        <div className="absolute inset-y-0 right-0 border-l-4 border-[#2c2d33] bg-[#232429]" style={{ width: sidewalk }}>
          <div className="absolute inset-y-0 left-0 w-2 bg-[repeating-linear-gradient(180deg,#e9b44c_0_8px,#0b0b0c_8px_16px)] opacity-70" />
          <div className="absolute inset-x-0 bottom-3 flex justify-center opacity-90">
            <FinishProps size={Math.round(lane * 0.55)} />
          </div>
        </div>

        {/* The panorama over the road: vehicles come out from under it. */}
        {height > 0 && (
          <div className="pointer-events-none absolute left-0 top-0 z-[5]">
            <Skyline width={world} height={band} marks={Array.from({ length: lanes + 1 }, (_, index) => sidewalk + index * lane)} />
          </div>
        )}

        <motion.div
          className="absolute z-10"
          style={{ top: middle, width: lane * 0.9, height: lane * 1.08, marginLeft: -(lane * 0.45), marginTop: -(lane * 0.54) }}
          initial={false}
          animate={{
            left: centerOf(position),
            rotate: lost ? 90 : 0,
            scale: lost ? 0.85 : 1,
            opacity: lost ? 0.8 : 1,
            filter: lost ? "grayscale(0.7)" : "grayscale(0)",
          }}
          transition={{ type: "spring", stiffness: 260, damping: 24, delay: lost ? 0.35 : 0 }}
        >
          <motion.div key={position} animate={reduce ? {} : { y: [0, -16, 0] }} transition={{ duration: 0.35 }} className="size-full">
            <CockFigure step={position} mood={lost ? "hit" : round?.status === "collected" ? "win" : "idle"} className="size-full drop-shadow-[0_8px_14px_rgba(0,0,0,0.6)]" />
          </motion.div>
          {/* The cock stands on his lane's plate, so its multiplier sits under him. */}
          {position > 0 && !lost && multipliers[position - 1] && (
            <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1f2a44] px-2 py-1 text-xs font-bold tabular-nums text-white shadow-lg ring-1 ring-[#8fb1ff]/60 sm:text-sm">
              {formatMultiplier(multipliers[position - 1])}
            </span>
          )}
        </motion.div>

        {/* The win bursts out of the cock: a screen-wide box centred on him, below the panorama. */}
        <AnimatePresence>
          {burst && (
            <div
              key={burst.id}
              className="pointer-events-none absolute bottom-0 z-30"
              style={{ top: band, left: centerOf(position) - view / 2, width: view }}
            >
              <WinBurst amount={burst.amount} onDone={onBurstDone} />
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Road details on a lane, away from the middle where the cock walks: a manhole or a painted arrow. */
function LaneMarks({ lane, band }: { lane: number; band: number }) {
  const roll = cosmetic(lane, 21);
  const low = cosmetic(lane, 22) > 0.5;
  // Between the panorama and the middle, or between the middle and the bottom edge.
  const top = low ? `calc(75% + ${band / 4}px)` : `calc(${band}px + (100% - ${band}px) * 0.22)`;
  if (roll < 0.35) {
    return (
      <span aria-hidden="true" className="absolute left-1/2 size-7 -translate-x-1/2 rounded-full border-2 border-[#34363d] bg-[repeating-linear-gradient(90deg,#26282e_0_3px,#1d1f24_3px_6px)] opacity-80" style={{ top }} />
    );
  }
  if (roll < 0.7) {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 40" className="absolute left-1/2 w-4 -translate-x-1/2 opacity-40" style={{ top }}>
        <path d="M10 40 V14 M3 20 L10 8 L17 20" stroke="#e8e2d0" strokeWidth="3" fill="none" strokeLinejoin="round" transform="rotate(180 10 20)" />
      </svg>
    );
  }
  return null;
}

function Plate({ value, size, state }: { value: number | undefined; size: number; state: "ahead" | "next" | "passed" | "crash" }) {
  const styles = {
    ahead: "border-white/10 bg-[radial-gradient(circle_at_40%_35%,#2c2d33,#16171b)] text-faint",
    next: "border-gold-bright bg-[radial-gradient(circle_at_40%_35%,#3a3120,#16171b)] text-gold-bright shadow-[0_0_24px_rgba(233,180,76,0.45)]",
    passed: "border-gold-bright bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] text-[#1a1204]",
    crash: "border-danger bg-[radial-gradient(circle_at_40%_35%,#5a1a1f,#1c0b0d)] text-danger",
  }[state];
  return (
    <span
      className={`grid place-items-center rounded-full border-[3px] font-bold tabular-nums tracking-tight ${styles} ${state === "next" ? "animate-pulse" : ""}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.24) }}
    >
      {value ? formatMultiplier(value) : ""}
    </span>
  );
}

function Barrier() {
  return (
    <svg viewBox="0 0 100 34" className="w-full drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]" aria-hidden="true">
      <defs>
        <pattern id="stripes" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="16" fill="#e9b44c" />
          <rect x="8" width="8" height="16" fill="#101114" />
        </pattern>
      </defs>
      <rect x="10" y="20" width="8" height="14" rx="2" fill="#6b6c73" />
      <rect x="82" y="20" width="8" height="14" rx="2" fill="#6b6c73" />
      <rect x="2" y="4" width="96" height="18" rx="4" fill="url(#stripes)" stroke="#f3cf73" strokeWidth="2" />
    </svg>
  );
}

/** The car that ends the round: it drives down its lane and stops with its nose on the cock. */
function CrashCar({ token, middle }: { token: number; middle: string }) {
  // Top edge of the cock, measured from the middle of the road below the panorama.
  const impact = `calc(${middle} - ${token / 2}px)`;
  return (
    <>
      <motion.div
        aria-hidden="true"
        className="absolute left-1/2 z-20 -ml-[18px] -mt-[58px]"
        style={{ top: impact }}
        initial={{ y: -360 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.35, ease: "easeIn" }}
      >
        <Vehicle kind="sedan" color="#ff6b6b" />
      </motion.div>
      <motion.span
        aria-hidden="true"
        className="absolute left-1/2 z-30 -ml-7 -mt-7 grid size-14 place-items-center"
        style={{ top: impact }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 1, 1.1], opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.2, delay: 0.3, times: [0, 0.25, 0.6, 1] }}
      >
        <svg viewBox="0 0 64 64" className="size-full" aria-hidden="true">
          <path d="M32 2l7 17 18-8-9 17 16 7-18 5 6 18-16-10-12 14-2-18-18 2 13-13L4 20l19 1z" fill="#ff6b6b" stroke="#ffe7a8" strokeWidth="2" />
        </svg>
      </motion.span>
    </>
  );
}
