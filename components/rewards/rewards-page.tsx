"use client";

import { motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { shortenAddress } from "@/lib/cardano/address";
import { formatInteger, formatTokenAmount } from "@/lib/format";
import { Spinner } from "../icons";
import { InfoBubble } from "../info-bubble";
import { useWallet } from "../wallet/wallet-provider";

type LossBoard = {
  asOf: string;
  nextAt: string;
  revealAt: string | null;
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

/** The rewards page: the curtain and its countdown, the wallet's rewards, and the public loss board. */
export function RewardsPage() {
  const [board, setBoard] = useState<LossBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNowSeconds();

  // Load the board, and again once the next daily update is due.
  useEffect(() => {
    let active = true;
    let timer = 0;
    const load = () =>
      fetch("/api/rewards")
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((data: LossBoard) => {
          if (!active) return;
          setBoard(data);
          setFailed(false);
          timer = window.setTimeout(load, Math.max(60_000, new Date(data.nextAt).getTime() - Date.now() + 10_000));
        })
        .catch(() => {
          if (!active) return;
          setFailed(true);
          timer = window.setTimeout(load, 60_000);
        });
    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden">
        <div className="grid-backdrop absolute inset-0" />
        <div className="absolute -top-40 left-[-10%] h-[30rem] w-[30rem] rounded-full bg-gold/[0.12] blur-[120px]" />
      </div>

      <div className="container-site relative pb-24 pt-28 sm:pt-32">
        <header className="max-w-3xl">
          <p className="kicker">Rewards</p>
          <h1 className="mt-3 flex flex-wrap items-center gap-3 text-4xl font-semibold leading-[1.02] tracking-[-0.03em] sm:text-5xl">
            <span>
              Something is behind the <span className="text-gold-gradient">curtain</span>.
            </span>
            <InfoBubble label="About this page">
              <span className="block">When the countdown ends, the curtain opens. Your rewards and the public board of lost stakes are below.</span>
            </InfoBubble>
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

/** Velvet drapes in black and gold with the countdown on the seam; they part when it ends and there is something to show. */
function Curtain({ remaining }: { remaining: number | null }) {
  const open = remaining === 0 && REVEAL !== null;
  const drape =
    "absolute inset-y-0 w-1/2 bg-[repeating-linear-gradient(90deg,#0a0907_0px,#1b160f_12px,#33281a_21px,#1b160f_30px,#0a0907_42px)] shadow-[inset_0_-80px_90px_rgba(0,0,0,0.75)]";
  return (
    <div className="relative isolate h-[22rem] overflow-hidden rounded-3xl border border-gold/30 bg-ink sm:h-[26rem]" aria-label="Curtain">
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

      <motion.div
        className="absolute inset-x-0 top-1/2 z-20 mx-auto w-fit -translate-y-1/2 rounded-2xl border border-gold/45 bg-ink/85 px-5 py-4 text-center shadow-[0_18px_50px_rgba(0,0,0,0.65)] backdrop-blur-md sm:px-7 sm:py-5"
        animate={{ opacity: open ? 0 : 1, scale: open ? 0.9 : 1 }}
        transition={{ duration: 0.6 }}
      >
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-gold/80">{remaining === 0 ? "Opening soon" : "Opens in"}</p>
        <p className="text-gold-gradient mt-1.5 font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl" aria-live="off">
          {remaining === null ? "–––:––:––" : clock(remaining)}
        </p>
        <p className="mt-1.5 grid grid-cols-[1.5fr_1fr_1fr] font-mono text-[0.58rem] uppercase tracking-[0.18em] text-faint">
          <span>hours</span>
          <span>min</span>
          <span>sec</span>
        </p>
      </motion.div>
    </div>
  );
}

/** Gold tassels along a drape's hem. */
function Fringe() {
  return <div className="absolute inset-x-0 bottom-0 h-4 bg-[repeating-linear-gradient(90deg,rgba(233,180,76,0.75)_0px,rgba(233,180,76,0.75)_2px,transparent_2px,transparent_6px)] opacity-80 [mask-image:linear-gradient(0deg,black,transparent)]" />;
}

const TOKENS: { ticker: string; name: string; icon: React.ReactNode }[] = [
  {
    ticker: "ADA",
    name: "Cardano",
    icon: <span className="grid size-full place-items-center bg-[#0033ad] text-base font-semibold text-white">₳</span>,
  },
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

/** The connected wallet's rewards per token; withdrawing opens once there is something to withdraw. */
function WalletRewards() {
  const { status, openDialog } = useWallet();
  const connected = status === "connected";
  return (
    <div className="glass flex flex-col rounded-3xl p-6 sm:p-7">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        Your rewards
        <InfoBubble label="About your rewards">
          <span className="block">Rewards for your wallet show here per token. Nothing is available to withdraw yet.</span>
        </InfoBubble>
      </h2>
      <ul className="mt-5 grid gap-2">
        {TOKENS.map((token) => (
          <li key={token.ticker} className="flex items-center gap-3 rounded-2xl border border-line bg-night/60 px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-raised ring-1 ring-line-strong">{token.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{token.ticker}</span>
              <span className="block text-xs text-faint">{token.name}</span>
            </span>
            <span className={`text-xl font-semibold tabular-nums ${connected ? "text-muted" : "text-faint"}`}>{connected ? "0" : "–"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-5">
        {!connected && (
          <button type="button" onClick={() => openDialog()} className="btn btn-ghost mb-2.5 w-full !py-2.5 text-sm" disabled={status === "connecting"}>
            {status === "connecting" && <Spinner size={15} />} Connect wallet to see your rewards
          </button>
        )}
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
        <p className="mt-3 text-center text-[0.68rem] text-faint">Game credit is not a reward and cannot be withdrawn.</p>
      </div>
    </div>
  );
}

/** Everything each player has lost in 300 Games, once a day. */
function LossBoardSection({ board, failed, now }: { board: LossBoard | null; failed: boolean; now: number | null }) {
  const { wallet } = useWallet();
  const mine = wallet?.stakeAddress ? shortenAddress(wallet.stakeAddress, 10, 6) : null;
  const nextIn = secondsUntil(board?.nextAt, now);
  return (
    <section aria-labelledby="losses-title" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 id="losses-title" className="kicker flex items-center gap-2">
            Lost in 300 Games
            <InfoBubble label="How losses are counted">
              <span className="block">
                Per wallet: every stake minus every win, over all finished rounds of every game. Wallets that are ahead are not listed. The board
                counts up to 00:00 UTC and updates once every 24 hours. Addresses are shortened.
              </span>
            </InfoBubble>
          </h2>
          <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
            {board ? formatTokenAmount(BigInt(board.total)) : "…"} <span className="text-gold-gradient">300</span>
          </p>
          <p className="mt-1 text-sm text-muted">{board ? `lost by ${formatInteger(board.players)} ${board.players === 1 ? "player" : "players"}` : " "}</p>
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
