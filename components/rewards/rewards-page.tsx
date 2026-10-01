"use client";

import { animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { shortenAddress } from "@/lib/cardano/address";
import { formatInteger, formatTokenAmount } from "@/lib/format";
import { LINKS } from "@/lib/site";
import { ArrowRight, Spinner } from "../icons";
import { InfoBubble } from "../info-bubble";
import { useWallet } from "../wallet/wallet-provider";

type LossBoard = {
  asOf: string;
  nextAt: string;
  revealAt: string | null;
  jackpot: number;
  total: number;
  players: number;
  rows: { wallet: string; lost: number; rounds: number }[];
};

/** Two weeks, the countdown's start: 336:00:00. */
const COUNTDOWN_SECONDS = 336 * 3600;

/**
 * What the curtain opens onto when the countdown ends. Nothing is named yet,
 * so until then the curtain stays shut at 000:00:00 (and nothing behind it is
 * in the page for anyone to peek at).
 */
const REVEAL: React.ReactNode = null;

// A clock that ticks once a second; before hydration there is no time (null).
const subscribeSeconds = (callback: () => void) => {
  const id = window.setInterval(callback, 1000);
  return () => window.clearInterval(id);
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const useNowSeconds = () => useSyncExternalStore(subscribeSeconds, nowSeconds, () => null);

const secondsUntil = (iso: string | null | undefined, now: number | null) =>
  iso && now !== null ? Math.max(0, Math.floor(new Date(iso).getTime() / 1000) - now) : null;

/** 336:00:00 — hours in three digits, then minutes and seconds. */
const clock = (seconds: number, hourDigits = 3) =>
  [String(Math.floor(seconds / 3600)).padStart(hourDigits, "0"), String(Math.floor((seconds % 3600) / 60)).padStart(2, "0"), String(seconds % 60).padStart(2, "0")].join(":");

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/** The jackpot, the board and the countdown time, fetched now and every minute. */
function useRewardsBoard() {
  const [board, setBoard] = useState<LossBoard | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/rewards")
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((data: LossBoard) => {
          if (!active) return;
          setBoard(data);
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);
  return { board, failed };
}

/** A number that counts up to its value, and on to each new value. */
function useCountUp(value: number | null) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (value === null) return;
    const controls = animate(from.current, value, {
      duration: reduce ? 0 : from.current === 0 ? 1.8 : 1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (current) => {
        from.current = current;
        setShown(Math.round(current));
      },
    });
    return () => controls.stop();
  }, [value, reduce]);
  return shown;
}

/** The rewards page: the jackpot, the curtain and its countdown, the wallet's rewards, and the public loss board. */
export function RewardsPage() {
  const { board, failed } = useRewardsBoard();
  const now = useNowSeconds();
  const jackpot = useCountUp(board?.jackpot ?? null);

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden">
        <div className="grid-backdrop absolute inset-0" />
        <div className="absolute -top-40 left-[-10%] h-[30rem] w-[30rem] rounded-full bg-gold/[0.12] blur-[120px]" />
      </div>

      <div className="container-site relative pb-24 pt-28 sm:pt-32">
        <header>
          <p className="kicker flex items-center gap-2">
            Jackpot
            <InfoBubble label="What the jackpot is">
              <span className="block">
                Every stake lost in 300 Games so far, starting credit included: a lane or round that loses adds its full stake. When the countdown
                ends, the curtain opens.
              </span>
            </InfoBubble>
          </p>
          <h1 className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-gold-gradient text-5xl font-bold leading-none tracking-[-0.03em] tabular-nums drop-shadow-[0_0_28px_rgba(233,180,76,0.35)] sm:text-7xl">
              {board ? formatTokenAmount(BigInt(jackpot)) : failed ? "–" : "…"}
            </span>
            <span className="text-2xl font-semibold text-gold/80 sm:text-3xl">300</span>
          </h1>
        </header>

        <section aria-label="Countdown and rewards" className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-[1.45fr_1fr]">
          <Curtain remaining={board ? (board.revealAt ? secondsUntil(board.revealAt, now) : COUNTDOWN_SECONDS) : null} />
          <WalletRewards />
        </section>

        <LossBoardSection board={board} failed={failed} now={now} />
      </div>
    </div>
  );
}

/** Velvet drapes in black and gold, and under them the countdown in red; they part when it ends and there is something to show. */
function Curtain({ remaining }: { remaining: number | null }) {
  const open = remaining === 0 && REVEAL !== null;
  const drape =
    "absolute inset-y-0 w-1/2 bg-[repeating-linear-gradient(90deg,#0a0907_0px,#1b160f_12px,#33281a_21px,#1b160f_30px,#0a0907_42px)] shadow-[inset_0_-80px_90px_rgba(0,0,0,0.75)]";
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-gold/30 bg-ink">
      <div className="relative isolate h-[17rem] flex-1 overflow-hidden sm:h-auto sm:min-h-[21rem]" aria-label="Curtain">
        {/* The stage behind the curtain. */}
        <div aria-hidden={!open} className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(233,180,76,0.22),transparent_62%)] p-6 text-center">
          {open && REVEAL}
        </div>

        <motion.div
          aria-hidden="true"
          className={`${drape} left-0 origin-top-left border-r border-gold/50`}
          animate={open ? { x: "-102%" } : { x: 0, skewX: [0, -0.6, 0] }}
          transition={open ? { duration: 1.6, ease: [0.65, 0, 0.35, 1] } : { duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          <Fringe />
        </motion.div>
        <motion.div
          aria-hidden="true"
          className={`${drape} right-0 origin-top-right border-l border-gold/50`}
          animate={open ? { x: "102%" } : { x: 0, skewX: [0, 0.6, 0] }}
          transition={open ? { duration: 1.6, ease: [0.65, 0, 0.35, 1] } : { duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
        >
          <Fringe />
        </motion.div>

        {/* The valance: a gold-trimmed pelmet with the 300 seal, scalloped along its lower edge. */}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 z-10">
          <div className="relative h-12 border-b border-gold/60 bg-[linear-gradient(180deg,#2a2115,#120f0a)] shadow-[0_6px_18px_rgba(0,0,0,0.6)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/300-logo.jpg" alt="" className="absolute left-1/2 top-full size-12 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-gold/70" />
          </div>
          <div className="h-3 bg-[radial-gradient(circle_at_50%_0,#120f0a_62%,rgba(233,180,76,0.55)_64%,transparent_70%)] bg-[length:28px_12px] bg-repeat-x" />
        </div>
      </div>

      {/* The countdown under the curtain, in red. */}
      <div className="border-t border-gold/30 bg-[linear-gradient(180deg,#140707,#050506)] px-4 pb-4 pt-3 text-center">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.24em] text-[#ff5a5a]/80">{remaining === 0 ? "Opening soon" : "Opens in"}</p>
        <p className="mt-1 font-mono text-5xl font-bold tabular-nums tracking-tight text-[#ff3d3d] drop-shadow-[0_0_18px_rgba(255,45,45,0.55)] sm:text-6xl">
          {remaining === null ? "–––:––:––" : clock(remaining)}
        </p>
        <p className="mx-auto mt-1 grid max-w-72 grid-cols-[1.5fr_1fr_1fr] font-mono text-[0.58rem] uppercase tracking-[0.18em] text-faint sm:max-w-80">
          <span>hours</span>
          <span>min</span>
          <span>sec</span>
        </p>
      </div>
    </div>
  );
}

/** Gold tassels along a drape's hem. */
function Fringe() {
  return <div className="absolute inset-x-0 bottom-0 h-4 bg-[repeating-linear-gradient(90deg,rgba(233,180,76,0.75)_0px,rgba(233,180,76,0.75)_2px,transparent_2px,transparent_6px)] opacity-80 [mask-image:linear-gradient(0deg,black,transparent)]" />;
}

/** The Cardano mark: rings of dots, white on Cardano blue. */
function CardanoMark() {
  const rings: [number, number, number, number][] = [
    // [dots, radius, dot size, start angle]
    [6, 4.2, 1.55, 0],
    [6, 7.4, 1.15, 30],
    [6, 9.6, 0.85, 0],
    [12, 11, 0.55, 15],
  ];
  return (
    <svg viewBox="-13 -13 26 26" className="size-full bg-[#0033ad]" aria-hidden="true">
      {rings.flatMap(([count, radius, size, start], ring) =>
        Array.from({ length: count }, (_, index) => {
          const angle = ((start + (index * 360) / count) * Math.PI) / 180;
          return <circle key={`${ring}-${index}`} cx={Math.cos(angle) * radius} cy={Math.sin(angle) * radius} r={size} fill="#fff" />;
        }),
      )}
    </svg>
  );
}

const TOKENS: { ticker: string; name: string; icon: React.ReactNode }[] = [
  { ticker: "ADA", name: "Cardano", icon: <CardanoMark /> },
  {
    ticker: "NIGHT",
    name: "Midnight",
    // eslint-disable-next-line @next/next/no-img-element -- the round mark at the left of the wordmark
    icon: <img src="/partners/midnight-logo-white.svg" alt="" className="size-full object-cover object-left p-1.5" />,
  },
  {
    ticker: "REALFI",
    name: "RealFi",
    // eslint-disable-next-line @next/next/no-img-element -- the round mark at the left of the wordmark
    icon: <img src="/partners/realfi-logo-white.svg" alt="" className="size-full object-cover object-left p-1.5" />,
  },
  {
    ticker: "300",
    name: "300 token",
    // eslint-disable-next-line @next/next/no-img-element
    icon: <img src="/300-logo.jpg" alt="" className="size-full object-cover" />,
  },
];

/** Each reward token with the wallet's amount; `compact` for the game terminal. */
function TokenList({ compact = false }: { compact?: boolean }) {
  const { status } = useWallet();
  const connected = status === "connected";
  return (
    <ul className={`grid ${compact ? "grid-cols-2 gap-1.5" : "gap-2"}`}>
      {TOKENS.map((token) => (
        <li key={token.ticker} className={`flex items-center border border-line bg-night/60 ${compact ? "gap-2 rounded-xl px-2.5 py-2" : "gap-3 rounded-2xl px-3.5 py-3"}`}>
          <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-raised ring-1 ring-line-strong ${compact ? "size-7" : "size-9"}`}>{token.icon}</span>
          <span className="min-w-0 flex-1">
            <span className={`block font-semibold ${compact ? "text-xs" : ""}`}>{token.ticker}</span>
            {!compact && <span className="block text-xs text-faint">{token.name}</span>}
          </span>
          <span className={`font-semibold tabular-nums ${compact ? "text-sm" : "text-xl"} ${connected ? "text-muted" : "text-faint"}`}>{connected ? "0" : "–"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Greyed out until there is something to withdraw. */
function WithdrawButton() {
  return (
    <>
      <button
        type="button"
        disabled
        aria-describedby="rewards-none"
        className="w-full cursor-not-allowed rounded-full border border-line bg-white/[0.04] px-5 py-3 text-sm font-semibold text-faint"
      >
        Withdraw rewards
      </button>
      <p id="rewards-none" className="mt-2 text-center text-xs text-faint">
        No rewards available yet.
      </p>
    </>
  );
}

/** The connected wallet's rewards per token; withdrawing opens once there is something to withdraw. */
function WalletRewards() {
  const { status, openDialog } = useWallet();
  return (
    <div className="glass flex flex-col rounded-3xl p-6 sm:p-7">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        Your rewards
        <InfoBubble label="About your rewards">
          <span className="block">Rewards for your wallet show here per token. Nothing is available to withdraw yet.</span>
        </InfoBubble>
      </h2>
      <div className="mt-5">
        <TokenList />
      </div>
      <div className="mt-auto pt-5">
        {status !== "connected" && (
          <button type="button" onClick={() => openDialog()} className="btn btn-ghost mb-2.5 w-full !py-2.5 text-sm" disabled={status === "connecting"}>
            {status === "connecting" && <Spinner size={15} />} Connect wallet to see your rewards
          </button>
        )}
        <WithdrawButton />
        <p className="mt-3 text-center text-[0.68rem] text-faint">Game credit is not a reward and cannot be withdrawn.</p>
      </div>
    </div>
  );
}

/**
 * The rewards tab of the game terminal: on desktops the jackpot and the
 * wallet's rewards, on phones a button to the rewards page.
 */
export function RewardsSummary() {
  const { board } = useRewardsBoard();
  const jackpot = useCountUp(board?.jackpot ?? null);
  const pageLink = "flex items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm font-semibold text-gold-bright transition hover:border-gold/70";
  return (
    <>
      <a href={LINKS.rewards} className={`${pageLink} lg:hidden`}>
        Rewards and jackpot <ArrowRight size={15} />
      </a>
      <div className="hidden space-y-3 lg:block">
        <div className="rounded-2xl border border-gold/30 bg-gold/[0.06] px-4 py-3">
          <p className="font-mono text-[0.62rem] uppercase tracking-[0.2em] text-gold/80">Jackpot</p>
          <p className="text-gold-gradient mt-0.5 text-3xl font-bold tabular-nums">
            {board ? formatTokenAmount(BigInt(jackpot)) : "…"} <span className="text-sm font-semibold text-gold/70">300</span>
          </p>
        </div>
        <TokenList compact />
        <WithdrawButton />
        <a href={LINKS.rewards} className={pageLink}>
          Rewards page <ArrowRight size={15} />
        </a>
      </div>
    </>
  );
}

/** Every player's lost stakes, counted once a day. */
function LossBoardSection({ board, failed, now }: { board: LossBoard | null; failed: boolean; now: number | null }) {
  const { wallet } = useWallet();
  const mine = wallet?.stakeAddress ? shortenAddress(wallet.stakeAddress, 10, 6) : null;
  const nextIn = secondsUntil(board?.nextAt, now);
  return (
    <section aria-labelledby="losses-title" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h2 id="losses-title" className="kicker flex items-center gap-2">
            Lost in 300 Games
            <InfoBubble label="How losses are counted">
              <span className="block">
                Per wallet: every stake that did not come back, over all finished rounds of every game, starting credit included. The board counts
                up to 00:00 UTC and updates once every 24 hours. Addresses are shortened.
              </span>
            </InfoBubble>
          </h2>
          {board && (
            <p className="mt-2 text-sm text-muted">
              {formatInteger(board.players)} {board.players === 1 ? "player" : "players"} · {formatTokenAmount(BigInt(board.total))} 300
            </p>
          )}
        </div>
        {board && (
          <p className="font-mono text-xs text-faint">
            As of {stamp(board.asOf)} · next update in <span className="tabular-nums text-muted">{nextIn === null ? "–" : nextIn === 0 ? "a moment" : clock(nextIn, 2)}</span>
          </p>
        )}
      </div>

      {!board ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          {failed ? "The board could not be loaded. Trying again in a minute." : <><Spinner size={16} /> Loading the board…</>}
        </p>
      ) : !board.rows.length ? (
        <p className="mt-6 text-sm text-muted">No losses yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-3xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.03] font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">
              <tr>
                <th scope="col" className="w-12 px-4 py-3 text-left font-normal">#</th>
                <th scope="col" className="px-2 py-3 text-left font-normal">Wallet</th>
                <th scope="col" className="hidden px-2 py-3 text-right font-normal sm:table-cell">Rounds</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Lost</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((row, index) => {
                const you = row.wallet === mine;
                return (
                  <tr key={row.wallet} className={`border-t border-line ${you ? "bg-gold/[0.07]" : ""}`}>
                    <td className={`px-4 py-3 tabular-nums ${index < 3 ? "font-semibold text-gold" : "text-faint"}`}>{index + 1}</td>
                    <td className="px-2 py-3 font-mono text-xs">
                      {row.wallet}
                      {you && <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 font-sans text-[0.66rem] font-semibold text-gold">You</span>}
                    </td>
                    <td className="hidden px-2 py-3 text-right tabular-nums text-muted sm:table-cell">{formatInteger(row.rounds)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatTokenAmount(BigInt(row.lost))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
