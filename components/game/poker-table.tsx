"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import type { Card } from "@/lib/game/blackjack";
import { POKER_SEATS, rankName, type PokerHand, type PokerPlayer, type PokerState, type PokerView } from "@/lib/game/poker";
import { subscribeBroadcast } from "@/lib/realtime";
import { play } from "@/lib/sound";
import type { ArenaGame } from "./arena";
import { WinBurst } from "./arena-effects";
import { CardBack } from "./card-race-stage";
import { Chip, OVERLAP, PlayingCard, TableClock, useClock, useElementSize, Winnings } from "./card-table";
import { GatorFigure, type GatorMood } from "./gator-figure";
import { BetStepper, GameFrame, Kbd, useGameKeys, type GameToast } from "./game-frame";
import { GamePanel, type WalletPanels } from "./terminal";

type Move = "fold" | "check" | "call" | "raise" | "allin";
/** Right after a hand: the hand whose pot is being paid out. */
type Payout = { id: number; landed: boolean };

type Props = {
  game: ArenaGame;
  /** The table (#poker/<table>; 1 without). */
  table: number;
  /** The page's game balance, shown until the table sends its own. */
  balance: number;
  enabled: boolean;
  load(table: number): Promise<PokerState>;
  unlock(code: string): Promise<void>;
  sit(table: number, seat: number, buyIn: number): Promise<PokerState>;
  addChips(table: number, amount: number): Promise<PokerState>;
  sitOut(table: number, out: boolean): Promise<PokerState>;
  leave(table: number): Promise<PokerState>;
  act(table: number, move: Move, amount?: number): Promise<PokerState>;
  onSettled(): void;
  onBack(): void;
  wallet: WalletPanels;
};

/** Seconds a countdown runs per decision (see game.pk_advance). */
const TURN_SECONDS = 20;
/** The countdown before a hand (see game.pk_step and game.pk_open_hand). */
const DEAL_SECONDS = 8;

const CARD_WIDTH = { seat: "clamp(1.6rem,5.4cqw,3rem)", front: "clamp(2.8rem,10.5cqw,5rem)", board: "clamp(2.2rem,9.2cqw,4.6rem)" } as const;

/**
 * The six seats round the rail, seat 1 on the left to seat 6 on the right, as
 * [x, y] in % of the table: where a player's plate stands (their cards and bet
 * lie in front of it, towards the middle).
 */
const PLACES = {
  narrow: [
    [11, 44],
    [13, 67],
    [32, 89],
    [68, 89],
    [87, 67],
    [89, 44],
  ],
  wide: [
    [12, 52],
    [22, 74],
    [39, 93],
    [61, 93],
    [78, 74],
    [88, 52],
  ],
} as const;
/** The deck beside the dealer; every hole card comes from there. */
const DECK = [64, 9] as const;
/** The pot, under the dealer. */
const POT = [50, 19] as const;

const ACTION_LABEL: Record<string, string> = {
  "small blind": "SB",
  "big blind": "BB",
  check: "Check",
  call: "Call",
  bet: "Bet",
  raise: "Raise",
  allin: "All in",
  fold: "Fold",
};

const errorCode = (cause: unknown) => (cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : null);
const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

/**
 * The poker room: Texas Hold'em, no limit, up to six players at a table, behind
 * a room code. The table moves on the server; this component shows what the
 * server pushes and sends the player's moves.
 */
export function PokerTable({ game, table, balance: pageBalance, enabled, load, unlock, sit, addChips, sitOut, leave, act, onSettled, onBack, wallet }: Props) {
  const reduce = useReducedMotion();
  const [view, setView] = useState<PokerState | null>(null);
  const [locked, setLocked] = useState(false);
  // Just came in with the code: a welcome instead of the last wrong-code message.
  const [opened, setOpened] = useState(false);
  const [code, setCode] = useState("");
  const [offset, setOffset] = useState(0);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyIn, setBuyIn] = useState<number | null>(null);
  const [raiseTo, setRaiseTo] = useState(0);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [burstSeen, setBurstSeen] = useState<number | null>(null);
  const [felt, size] = useElementSize<HTMLDivElement>();
  const now = useClock();
  const viewRef = useRef<PokerState | null>(null);
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  });

  // The server's answer or push, and the server's clock (countdowns run on it). Older states than the one
  // shown are dropped; what changed plays its sound: the deal, a check (a knock), chips, the board.
  const receive = useCallback((next: PokerView, you?: PokerState["you"]) => {
    const previous = viewRef.current;
    if (previous && previous.table === next.table && Date.parse(next.now) < Date.parse(previous.now)) {
      if (you) {
        const merged = { ...previous, you };
        viewRef.current = merged;
        setView(merged);
      }
      return;
    }
    setOffset(Date.parse(next.now) - Date.now());
    const before = previous?.hand;
    const after = before ? (next.hand?.id === before.id ? next.hand : next.last?.id === before.id ? next.last : null) : null;
    if (before && after) {
      if (before.status === "waiting" && after.status !== "waiting") {
        // The deal: two cards to every player, one after the other.
        for (let card = 0; card < after.players.length * 2; card += 1) window.setTimeout(() => play("flip"), 200 + card * 140);
      } else {
        const moved = after.players.filter((player) => player.action && before.players.find((old) => old.seat === player.seat)?.action !== player.action);
        const last = moved[moved.length - 1];
        if (last) play(last.action === "check" ? "knock" : last.action === "fold" ? "click" : "chip");
        for (let card = before.board.length; card < after.board.length; card += 1) window.setTimeout(() => play("flip"), 350 + (card - before.board.length) * 220);
      }
      if (before.status === "playing" && after.status === "done" && !reduceRef.current) setPayout({ id: after.id, landed: false });
    }
    const merged = { ...next, you: you ?? previous?.you ?? { seat: null, table: null, topic: "", hand: null, balance: 0 } };
    viewRef.current = merged;
    setView(merged);
  }, []);

  const refresh = useCallback(
    () =>
      load(table).then(
        (state) => {
          setLocked(false);
          receive(state, state.you);
        },
        (cause: unknown) => (errorCode(cause) === "room_locked" ? setLocked(true) : setError(errorText(cause, "The table could not be loaded."))),
      ),
    [load, table, receive],
  );

  // First look, then live pushes on the table's topic (known once the room code is in); a heartbeat keeps
  // the seat, and while the push channel is down the table is polled.
  const topic = view?.you.topic ?? "";
  useEffect(() => {
    void refresh();
    const heartbeat = window.setInterval(() => void refresh(), 25_000);
    return () => window.clearInterval(heartbeat);
  }, [refresh]);
  useEffect(() => {
    if (!topic) return;
    return subscribeBroadcast<PokerView>(topic, "state", (payload) => receive(payload), setLive);
  }, [topic, receive]);
  useEffect(() => {
    if (live || locked) return;
    const id = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(id);
  }, [live, locked, refresh]);

  const hand = view?.hand ?? null;
  const serverNow = now === null ? null : now + offset;
  const deadline = hand?.status === "waiting" ? hand.startsAt : hand?.status === "playing" ? hand.turnDeadline : null;
  // When a countdown runs out, ask the table to move on (the scheduled tick does it too, a little later).
  useEffect(() => {
    if (!deadline) return;
    const wait = Date.parse(deadline) - (Date.now() + offset) + 400;
    const id = window.setTimeout(() => void refresh(), Math.max(200, wait));
    return () => window.clearTimeout(id);
  }, [deadline, offset, refresh]);
  const remaining = deadline && serverNow !== null ? Math.max(0, (Date.parse(deadline) - serverNow) / 1000) : null;

  const you = view?.you ?? null;
  const mySeat = you && you.table === table ? you.seat : null;
  const me = view?.seats.find((seat) => seat.seat === mySeat) ?? null;
  const balance = you?.balance ?? pageBalance;
  // The hand on the cloth: the running one, or while the next one waits, the last one (faded).
  const shown: PokerHand | null = hand && (hand.status !== "waiting" || !view?.last) ? hand : (view?.last ?? hand);
  const justFinished = !!view?.last?.finishedAt && serverNow !== null && serverNow - Date.parse(view.last.finishedAt) < 5000;
  const fading = hand?.status === "waiting" && shown !== hand && !justFinished;
  const myCards = you?.hand && shown && you.hand.id === shown.id ? you.hand.cards : null;
  const myPlayer = myCards && shown ? (shown.players.find((player) => player.seat === you?.hand?.seat) ?? null) : null;

  // A hand dealt to this player whose cards the page does not have yet: ask for them (once per hand).
  const askedFor = useRef<number | null>(null);
  const missingCards = hand?.status === "playing" && mySeat !== null && hand.players.some((player) => player.seat === mySeat) && you?.hand?.id !== hand.id ? hand.id : null;
  useEffect(() => {
    if (missingCards === null || askedFor.current === missingCards) return;
    askedFor.current = missingCards;
    void refresh();
  }, [missingCards, refresh]);

  const turnPlayer = hand?.status === "playing" ? (hand.players.find((player) => player.seat === hand.turnSeat) ?? null) : null;
  const myTurn = !!turnPlayer && shown === hand && !!myPlayer && myPlayer.seat === turnPlayer.seat;
  const stack = me?.stack ?? 0;
  const toCall = myTurn && hand && myPlayer ? Math.max(0, hand.currentBet - myPlayer.bet) : 0;
  const maxTo = myTurn && myPlayer ? myPlayer.bet + stack : 0;
  const minTo = hand ? Math.min(hand.currentBet + hand.minRaise, maxTo) : 0;
  const canRaise = myTurn && !!hand && maxTo > hand.currentBet;
  const raise = Math.min(maxTo, Math.max(minTo, raiseTo));
  const big = view?.blinds.big ?? 300;
  const pot = hand?.status === "playing" ? hand.pot : 0;
  // Raise to: half the pot or the pot on top of the call.
  const potRaise = (share: number) => Math.min(maxTo, Math.max(minTo, (hand?.currentBet ?? 0) + Math.floor((pot + toCall) * share)));

  const buyInRange = view?.buyIn ?? { min: 3000, max: 30000 };
  const chosenBuyIn = Math.min(buyInRange.max, Math.max(buyInRange.min, buyIn ?? buyInRange.min));
  const topUp = me ? Math.min(buyInRange.max - stack, balance) : 0;
  const inHand = hand?.status === "playing" && !!myPlayer && myPlayer.status !== "folded" && shown === hand;

  // The pot is paid: chips fly from the middle to the winners for a moment.
  useEffect(() => {
    if (!payout) return;
    const id = payout.landed ? window.setTimeout(() => setPayout(null), 2600) : window.setTimeout(() => setPayout({ ...payout, landed: true }), 1400);
    return () => window.clearTimeout(id);
  }, [payout]);
  const finished = shown?.status === "done" ? shown : null;
  const paying = !!payout && payout.id === finished?.id;

  // This player's last finished hand: the result, while it is fresh.
  const myResult = finished && myPlayer ? { id: finished.id, won: myPlayer.won, net: myPlayer.won - myPlayer.total, player: myPlayer } : null;
  const fresh = !!myResult && !!finished?.finishedAt && serverNow !== null && serverNow - Date.parse(finished.finishedAt) < 20_000;
  const burst =
    fresh && myResult && myResult.net > 0 && payout?.id === myResult.id && payout.landed && burstSeen !== myResult.id && !reduce && hand?.status !== "playing" ? myResult : null;

  // Once per finished hand this player was in: the page's balance and history catch up.
  const settledHands = useRef(new Set<number>());
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });
  const settledId = myResult?.id ?? null;
  useEffect(() => {
    if (settledId === null || settledHands.current.has(settledId)) return;
    settledHands.current.add(settledId);
    onSettledRef.current();
  }, [settledId]);

  const run = async (task: () => Promise<PokerState>, sound?: Parameters<typeof play>[0]) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = await task();
      receive(state, state.you);
      if (sound) play(sound);
    } catch (cause) {
      setError(errorText(cause, "That did not work. Try again."));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const enter = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(code.trim());
      setCode("");
      setOpened(true);
      play("click");
      await refresh();
    } catch (cause) {
      setError(errorText(cause, "That code did not open the room."));
    } finally {
      setBusy(false);
    }
  };

  const freeSeats = Array.from({ length: POKER_SEATS }, (_, index) => index + 1).filter((seat) => !view?.seats.some((taken) => taken.seat === seat));
  const preferredSeat = [3, 4, 2, 5, 1, 6].find((seat) => freeSeats.includes(seat)) ?? null;
  const takeSeat = (seat: number | null) => seat !== null && chosenBuyIn <= balance && run(() => sit(table, seat, chosenBuyIn), "chip");
  const move = (next: Move, amount?: number) => myTurn && run(() => act(table, next, amount));
  const sittingOut = !!me?.sittingOut;

  useGameKeys({
    f: () => move("fold"),
    c: () => move(toCall > 0 ? "call" : "check"),
    k: () => toCall === 0 && move("check"),
    r: () => canRaise && move("raise", raise),
    a: () => myTurn && move("allin"),
    enter: () => (locked ? void enter() : mySeat === null ? takeSeat(preferredSeat) : undefined),
    up: () => (myTurn ? setRaiseTo(Math.min(maxTo, raise + big)) : setBuyIn(Math.min(buyInRange.max, chosenBuyIn + big * 10))),
    down: () => (myTurn ? setRaiseTo(Math.max(minTo, raise - big)) : setBuyIn(Math.max(buyInRange.min, chosenBuyIn - big * 10))),
  });

  const readyPlayers = view?.seats.filter((seat) => !seat.sittingOut && seat.stack > 0).length ?? 0;
  const prompt = locked
    ? "Private room · enter the room code"
    : !view
      ? "Loading the table…"
      : mySeat === null
        ? freeSeats.length
          ? "Choose your buy-in and take a seat"
          : "The table is full"
        : myTurn
          ? toCall > 0
            ? `Your move: call ${formatTokenAmount(BigInt(Math.min(toCall, stack)))}, raise or fold`
            : "Your move: check or bet"
          : inHand
            ? `Waiting for ${turnPlayer?.name ?? "the table"}`
            : stack === 0
              ? "Out of chips · top up to keep playing"
              : sittingOut
                ? "You sit out · come back for the next hand"
                : hand?.status === "playing"
                  ? "This hand is running · you play the next one"
                  : readyPlayers < 2
                    ? "Waiting for a second player"
                    : "The cards are coming";

  const toast: GameToast | null = error
    ? { id: `error-${error}`, text: error, tone: "error" }
    : opened && mySeat === null
      ? { id: "opened", text: "Welcome to the poker room · take a seat", tone: "win" }
      : myResult && fresh && myResult.player.status !== "folded" && !paying
      ? {
          id: `result-${myResult.id}`,
          text: `${myResult.net > 0 ? "+" : myResult.net < 0 ? "−" : "±"}${formatTokenAmount(BigInt(Math.abs(myResult.net)))}${
            myResult.player.rank !== null ? ` · ${rankName(myResult.player.rank)}` : myResult.net > 0 ? " · everyone folded" : ""
          }`,
          tone: myResult.net > 0 ? "win" : "info",
        }
      : !enabled
        ? { id: "paused", text: "Games are paused right now.", tone: "warn" }
        : null;

  const panel = (
    <GamePanel
      prompt={prompt}
      options={
        mySeat !== null && me ? (
          <div className="flex items-center justify-between gap-2 text-xs text-faint">
            <span className="min-w-0 truncate">
              Seat {mySeat} · <span className="font-semibold text-text">{me.name}</span> · {formatTokenAmount(BigInt(stack))} at the table
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {!inHand && topUp > 0 && (
                <button
                  type="button"
                  onClick={() => run(() => addChips(table, topUp), "chip")}
                  className="rounded-lg border border-line px-2 py-1 font-semibold text-muted transition hover:border-gold/40 hover:text-gold-bright"
                  title={`Bring ${formatTokenAmount(BigInt(topUp))} more from your balance`}
                >
                  Top up
                </button>
              )}
              {!(inHand && myPlayer?.status === "allin") && (
                <button
                  type="button"
                  onClick={() => run(() => leave(table), "click")}
                  className="rounded-lg border border-line px-2 py-1 font-semibold text-muted transition hover:border-danger/40 hover:text-danger"
                  title={inHand ? "Folds this hand; your chips go back to your balance" : "Your chips go back to your balance"}
                >
                  Leave
                </button>
              )}
            </span>
          </div>
        ) : undefined
      }
      bet={{
        bets: { min: buyInRange.min, max: buyInRange.max, step: big * 10 },
        bet: chosenBuyIn,
        onChange: setBuyIn,
        disabled: locked || mySeat !== null,
        affordable: (amount) => amount <= balance,
        label: "Buy-in",
        // Only before sitting down there is an amount to choose here.
        hidden: locked || mySeat !== null,
      }}
      play={
        locked
          ? { label: "Enter the room", amount: null, onPlay: () => void enter(), playable: !!code.trim() && !busy, auto: "off", onAuto: () => undefined, lockable: false, kbd: <Kbd>Enter</Kbd> }
          : myTurn
            ? toCall > 0
              ? {
                  label: Math.min(toCall, stack) === stack ? "Call · all in" : "Call",
                  amount: Math.min(toCall, stack),
                  onPlay: () => move("call"),
                  playable: !busy,
                  auto: "off",
                  onAuto: () => undefined,
                  lockable: false,
                  tone: "green",
                  kbd: <Kbd>C</Kbd>,
                }
              : { label: "Check", amount: null, onPlay: () => move("check"), playable: !busy, auto: "off", onAuto: () => undefined, lockable: false, tone: "green", kbd: <Kbd>C</Kbd> }
            : mySeat === null
              ? {
                  label: "Buy in · take a seat",
                  amount: chosenBuyIn,
                  onPlay: () => takeSeat(preferredSeat),
                  playable: preferredSeat !== null && chosenBuyIn <= balance && !busy && enabled,
                  auto: "off",
                  onAuto: () => undefined,
                  lockable: false,
                  kbd: <Kbd>Enter</Kbd>,
                }
              : stack === 0 && topUp > 0 && !inHand
                ? { label: "Top up", amount: topUp, onPlay: () => run(() => addChips(table, topUp), "chip"), playable: !busy, auto: "off", onAuto: () => undefined, lockable: false }
                : { label: "Your stack", amount: stack, onPlay: () => undefined, playable: false, auto: "off", onAuto: () => undefined, lockable: false }
      }
      side={
        locked ? undefined : myTurn ? (
          <SideButton label="Fold" onClick={() => move("fold")} tone="danger" shortcut="F" disabled={busy} />
        ) : mySeat !== null ? (
          sittingOut ? (
            <SideButton label="I'm back" onClick={() => run(() => sitOut(table, false), "click")} tone="gold" disabled={busy} />
          ) : (
            <SideButton label="Sit out" onClick={() => run(() => sitOut(table, true), "click")} tone="plain" disabled={busy} />
          )
        ) : undefined
      }
      below={
        myTurn && canRaise ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-4 gap-1.5 text-xs">
              {[
                { label: "Min", value: minTo },
                { label: "½ pot", value: potRaise(0.5) },
                { label: "Pot", value: potRaise(1) },
                { label: "Max", value: maxTo },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setRaiseTo(preset.value)}
                  className={`rounded-lg border px-1 py-1.5 font-semibold transition ${raise === preset.value ? "border-gold/60 bg-gold/15 text-gold-bright" : "border-line text-muted hover:text-text"}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <BetStepper bets={{ min: minTo, max: maxTo, step: big }} bet={raise} onChange={setRaiseTo} disabled={busy} affordable={(amount) => amount <= maxTo} label={hand?.currentBet ? "Raise to" : "Bet"} compact />
            <div className="grid grid-cols-2 gap-2">
              <ActionButton label={`${raise === maxTo ? "All in" : hand?.currentBet ? "Raise to" : "Bet"} ${formatTokenAmount(BigInt(raise))}`} shortcut="R" onClick={() => move("raise", raise)} disabled={busy} />
              <ActionButton label="All in" shortcut="A" onClick={() => move("allin")} disabled={busy} />
            </div>
          </div>
        ) : undefined
      }
      lastWin={myResult && myResult.net > 0 ? myResult.won : null}
      balance={balance}
      wallet={wallet}
    />
  );

  const rules = (
    <>
      <span className="block">
        Texas Hold&apos;em, no limit, up to six players. Blinds {formatTokenAmount(BigInt(view?.blinds.small ?? 150))}/{formatTokenAmount(BigInt(big))}, buy-in{" "}
        {formatTokenAmount(BigInt(buyInRange.min))} to {formatTokenAmount(BigInt(buyInRange.max))} from your game credit.
      </span>
      <span className="mt-2 block">Two cards each, five on the board; the best five of seven win. A hand starts when two players sit with chips.</span>
      <span className="mt-2 block">20 seconds per decision; when the time runs out you check or fold, and sit out until you come back.</span>
      <span className="mt-2 block">No rake: every pot goes to the players in full. Your chips go back to your balance when you leave the table.</span>
      <span className="mt-2 block text-xs text-faint">
        Provably fair: the deck is shuffled with HMAC-SHA256(server seed, &quot;client seeds of the players | joined:hand:poker:n&quot;); the server seed is
        committed before the deal and revealed after the hand.
      </span>
      {hand && <span className="mt-2 block break-all font-mono text-[0.65rem] text-faint">Hand {hand.id} · seed hash {hand.serverSeedHash}</span>}
      {view?.last?.serverSeed && (
        <span className="mt-1 block break-all font-mono text-[0.65rem] text-faint">
          Hand {view.last.id} · seed {view.last.serverSeed} · client seeds {view.last.clientSeed}
        </span>
      )}
    </>
  );

  const places = size.width >= 640 ? PLACES.wide : PLACES.narrow;
  const dealt = shown?.players.map((player) => player.seat) ?? [];
  const fromDeck = (x: number, y: number) => ({ x: ((DECK[0] - x) / 100) * size.width, y: ((DECK[1] - y) / 100) * size.height + 30 });
  const clock =
    remaining !== null && hand?.status === "waiting" && hand.startsAt
      ? { label: "Next hand", total: DEAL_SECONDS, urgent: false, audible: mySeat !== null && !sittingOut && stack > 0 }
      : remaining !== null && hand?.status === "playing" && turnPlayer
        ? { label: myTurn ? "Your move" : turnPlayer.name, total: TURN_SECONDS, urgent: myTurn, audible: myTurn }
        : null;
  const status = locked
    ? null
    : !hand
      ? "Opening the table…"
      : hand.status === "waiting" && !hand.startsAt
        ? readyPlayers === 1
          ? "Waiting for a second player"
          : "Take a seat · two players start a hand"
        : null;
  const winners = finished ? finished.players.filter((player) => player.won > player.total) : [];
  const dealerMood: GatorMood = paying ? "win" : hand?.status === "playing" && shown === hand ? "think" : "idle";

  return (
    <GameFrame gameId="poker" payoutBps={game.payoutBps} onBack={onBack} info={rules} panel={panel} toast={toast}>
      <div
        ref={felt}
        data-live={live ? "on" : "off"}
        className="@container relative h-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_100%,#14100a,#050506_70%)] sm:rounded-2xl sm:border sm:border-gold/25"
      >
        <Felt />
        <Deck />
        <div className="absolute left-1/2 top-[1%] z-10 flex -translate-x-1/2 flex-col items-center">
          <div className="w-[clamp(4.2rem,17cqw,7.5rem)]" role="img" aria-label="The dealer: the Gator, DEGEN #007">
            <GatorFigure mood={dealerMood} className="w-full drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)]" />
          </div>
          <p className="relative -mt-[6%] rounded-full border border-gold/40 bg-black/75 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.2em] text-gold-bright shadow-lg">Dealer</p>
        </div>

        {locked ? (
          <CodeDoor code={code} onCode={setCode} onEnter={() => void enter()} busy={busy} />
        ) : (
          <>
            {/* The pot and the board in the middle. */}
            <div className={`absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5 transition-opacity ${fading ? "opacity-50" : ""}`} style={{ top: `${POT[1]}%` }}>
              <p
                className={`flex items-center gap-1.5 rounded-full border border-gold/35 bg-black/70 px-2.5 py-0.5 font-mono text-[0.62rem] font-bold uppercase tracking-[0.14em] text-gold-bright @[40rem]:text-xs ${
                  shown?.pot && !fading ? "" : "invisible"
                }`}
              >
                Pot <span className="tabular-nums text-text">{formatTokenAmount(BigInt(shown?.pot ?? 0))}</span>
              </p>
              <Board hand={shown} reduce={!!reduce} />
              {finished && finished.players.some((player) => player.rank !== null) && winners[0]?.rank != null && (
                <p className="rounded-full bg-black/70 px-2.5 py-0.5 text-[0.62rem] font-semibold text-gold-bright @[40rem]:text-xs">
                  {winners.map((winner) => winner.name).join(" & ")} · {rankName(winners[0].rank)}
                </p>
              )}
            </div>

            {/* The countdown, or what the table is waiting for. */}
            <div className="absolute inset-x-0 top-[52%] z-20 flex -translate-y-1/2 flex-col items-center gap-2 px-3 text-center @[40rem]:top-[58%]">
              {burst ? null : clock && remaining !== null ? (
                <TableClock key={`${hand?.id}-${hand?.status}-${hand?.turnSeat}`} label={clock.label} remaining={remaining} total={clock.total} urgent={clock.urgent} audible={clock.audible} />
              ) : (
                status && <p className="rounded-full border border-white/10 bg-black/45 px-3 py-1 text-xs font-semibold text-muted @[40rem]:text-sm">{status}</p>
              )}
            </div>

            {Array.from({ length: POKER_SEATS }, (_, index) => {
              const number = index + 1;
              const [x, y] = places[index];
              const seat = view?.seats.find((entry) => entry.seat === number) ?? null;
              const player = shown?.players.find((entry) => entry.seat === number) ?? null;
              const mine = mySeat === number;
              const turn = !!turnPlayer && shown === hand && turnPlayer.seat === number;
              return (
                <Place
                  key={number}
                  number={number}
                  x={x}
                  y={y}
                  seat={seat}
                  player={player && (seat ? seat.name === player.name : !fading) ? player : null}
                  handId={shown?.id ?? 0}
                  cards={mine && myCards ? myCards : (player?.cards ?? null)}
                  you={mine}
                  button={shown?.button === number}
                  faded={fading}
                  timeShare={turn && remaining !== null ? remaining / TURN_SECONDS : null}
                  canSit={!seat && !busy && enabled && mySeat === null && chosenBuyIn <= balance}
                  onSit={() => takeSeat(number)}
                  fly={fromDeck(x, y)}
                  dealIndex={dealt.indexOf(number)}
                  dealtCount={dealt.length}
                  showdown={!!finished && finished.street === "showdown"}
                  reduce={!!reduce}
                />
              );
            })}
          </>
        )}

        {/* The pot goes to the winners: chips fly from the middle to each of them. */}
        {paying && finished && !reduce && (
          <Winnings
            key={finished.id}
            width={size.width}
            height={size.height}
            from={{ x: POT[0], y: POT[1] + 8 }}
            targets={winners.map((winner) => ({
              id: winner.seat,
              x: places[winner.seat - 1][0],
              y: places[winner.seat - 1][1] - 10,
              chips: Math.min(8, 2 + Math.floor((winner.won - winner.total) / 1500)),
            }))}
          />
        )}

        <AnimatePresence>{burst && <WinBurst key={burst.id} amount={burst.won} duration={1800} onDone={() => setBurstSeen(burst.id)} />}</AnimatePresence>
        <p className="sr-only" aria-live="polite">
          {prompt}
        </p>
      </div>
    </GameFrame>
  );
}

/** Left of the main button: fold on a turn, sit out or come back between hands. */
function SideButton({ label, onClick, tone, shortcut, disabled }: { label: string; onClick(): void; tone: "danger" | "gold" | "plain"; shortcut?: string; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 font-bold transition disabled:opacity-45 lg:min-h-14 lg:rounded-2xl lg:text-lg ${
        tone === "danger"
          ? "border border-danger/50 bg-danger/15 text-[#ff9b9b] enabled:hover:bg-danger/25"
          : tone === "gold"
            ? "bg-[linear-gradient(180deg,var(--color-gold-bright),var(--color-gold))] text-[#1a1204] shadow-[0_10px_30px_-12px_rgba(233,180,76,0.8)] enabled:hover:brightness-110"
            : "border border-line-strong bg-white/[0.04] text-text enabled:hover:border-gold/50"
      }`}
    >
      {label} {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  );
}

/** Raise and all in, under fold and call. */
function ActionButton({ label, shortcut, onClick, disabled }: { label: string; shortcut: string; onClick(): void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-white/[0.04] px-2 text-sm font-semibold text-text transition enabled:hover:border-gold/50 enabled:hover:text-gold-bright disabled:opacity-35 lg:min-h-12"
    >
      <span className="truncate">{label}</span> <Kbd>{shortcut}</Kbd>
    </button>
  );
}

/** The table: green cloth, leather rail with a gold line, the room's name in an arc. */
function Felt() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute bottom-[2%] left-[-22%] right-[-22%] top-[-70%] rounded-[50%] bg-[radial-gradient(ellipse_at_50%_70%,#1d6342_0%,#124a31_42%,#0b2f1f_78%)] shadow-[0_0_0_9px_#1f150c,0_0_0_11px_rgba(233,180,76,0.6),0_0_0_13px_#120c07,0_30px_70px_rgba(0,0,0,0.75)]" />
      <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_38%,rgba(255,255,255,0.06)_50%,transparent_62%)] bg-[length:260%_100%] animate-felt-sheen motion-reduce:animate-none" />
      <svg viewBox="0 0 200 60" className="absolute left-[30%] top-[37%] h-[7%] w-[40%] overflow-visible @[40rem]:top-[43%]" preserveAspectRatio="xMidYMid meet">
        <defs>
          <path id="pk-arc-1" d="M 18 10 Q 100 52 182 10" />
          <path id="pk-arc-2" d="M 30 24 Q 100 62 170 24" />
        </defs>
        <text fill="rgba(233,180,76,0.55)" fontSize="8.5" fontWeight="700" letterSpacing="2.4" style={{ fontFamily: "var(--font-mono)" }}>
          <textPath href="#pk-arc-1" startOffset="50%" textAnchor="middle">
            300 POKER ROOM
          </textPath>
        </text>
        <text fill="rgba(233,180,76,0.35)" fontSize="5.5" letterSpacing="1.6" style={{ fontFamily: "var(--font-mono)" }}>
          <textPath href="#pk-arc-2" startOffset="50%" textAnchor="middle">
            NO LIMIT HOLD&apos;EM · NO RAKE
          </textPath>
        </text>
      </svg>
    </div>
  );
}

/** The deck beside the dealer. */
function Deck() {
  return (
    <div aria-hidden="true" className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rotate-[8deg]" style={{ left: `${DECK[0]}%`, top: `${DECK[1]}%` }}>
      <div className="relative aspect-[5/7] w-[clamp(1.6rem,5.5cqw,3rem)]">
        <CardBack className="absolute inset-0 translate-x-[3px] translate-y-[3px] opacity-60" />
        <CardBack className="absolute inset-0 translate-x-[1.5px] translate-y-[1.5px] opacity-80" />
        <CardBack className="absolute inset-0 shadow-lg shadow-black/70" />
      </div>
    </div>
  );
}

/** The five board cards; empty places show where the next ones fall. */
function Board({ hand, reduce }: { hand: PokerHand | null; reduce: boolean }) {
  const board = hand?.status === "waiting" ? [] : (hand?.board ?? []);
  return (
    <div className="flex gap-[clamp(0.2rem,1.2cqw,0.55rem)]" style={{ "--card": CARD_WIDTH.board } as React.CSSProperties}>
      {Array.from({ length: 5 }, (_, index) =>
        index < board.length ? (
          <PlayingCard
            key={`${hand?.id}-${index}`}
            card={board[index]}
            // The flop turns over card by card; the turn and the river on their own.
            entry={{ flip: true, delay: index < 3 ? index * 0.15 : 0 }}
            reduce={reduce}
          />
        ) : (
          <span key={`empty-${index}`} className="block aspect-[5/7] w-[var(--card)] rounded-[12%/9%] border border-dashed border-gold/20 bg-black/15" />
        ),
      )}
    </div>
  );
}

/** The room's door: the code opens it. */
function CodeDoor({ code, onCode, onEnter, busy }: { code: string; onCode(code: string): void; onEnter(): void; busy: boolean }) {
  return (
    <form
      className="absolute left-1/2 top-[52%] z-30 flex w-[min(20rem,84cqw)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-3xl border border-gold/40 bg-[linear-gradient(180deg,rgba(26,20,10,0.92),rgba(5,5,6,0.92))] p-5 text-center shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9),0_0_40px_rgba(233,180,76,0.15)]"
      onSubmit={(event) => {
        event.preventDefault();
        onEnter();
      }}
    >
      <span className="grid size-11 place-items-center rounded-2xl bg-gold/15 text-gold-bright">
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 018 0v3" />
        </svg>
      </span>
      <div>
        <p className="font-semibold text-text">Private room</p>
        <p className="mt-0.5 text-xs text-muted">Enter the room code to sit at the poker table.</p>
      </div>
      <label className="sr-only" htmlFor="poker-code">
        Room code
      </label>
      <input
        id="poker-code"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={32}
        value={code}
        onChange={(event) => onCode(event.target.value.replace(/[^0-9A-Za-z]/g, ""))}
        className="w-full rounded-2xl border border-line-strong bg-ink px-4 py-3 text-center font-mono text-xl tracking-[0.5em] outline-none focus:border-gold"
        placeholder="••••"
      />
      <button type="submit" className="btn btn-gold w-full" disabled={busy || !code}>
        Enter the room
      </button>
    </form>
  );
}

/** One place at the rail: the player's plate, their cards and their bet in front of it. */
function Place({
  number,
  x,
  y,
  seat,
  player,
  handId,
  cards,
  you,
  button,
  faded,
  timeShare,
  canSit,
  onSit,
  fly,
  dealIndex,
  dealtCount,
  showdown,
  reduce,
}: {
  number: number;
  x: number;
  y: number;
  seat: PokerView["seats"][number] | null;
  /** The player of the hand on the cloth at this place. */
  player: PokerPlayer | null;
  handId: number;
  /** Face up: the viewer's own, or everyone's left at the showdown. */
  cards: Card[] | null;
  you: boolean;
  button: boolean;
  faded: boolean;
  /** While it is this place's turn: the share of the decision time left. */
  timeShare: number | null;
  canSit: boolean;
  onSit(): void;
  fly: { x: number; y: number };
  dealIndex: number;
  dealtCount: number;
  showdown: boolean;
  reduce: boolean;
}) {
  const active = timeShare !== null;
  const folded = player?.status === "folded";
  const winner = !!player && player.won > player.total;
  const name = seat?.name ?? player?.name ?? null;
  const label = player?.action ? ACTION_LABEL[player.action] : null;
  return (
    <div
      className={`absolute flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 ${you ? "z-20 w-[clamp(5.2rem,21cqw,10rem)]" : "z-10 w-[clamp(4rem,16cqw,7.5rem)]"}`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {/* In front of the player: the bet of this betting round, then the cards. */}
      <div className={`flex min-h-5 items-center gap-1 transition-opacity ${faded ? "opacity-45" : ""}`}>
        <AnimatePresence>
          {player && player.bet > 0 && !faded && (
            <motion.span key="bet" initial={reduce ? false : { y: 16, opacity: 0, scale: 0.6 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -24, opacity: 0, scale: 0.6 }}>
              <Chip amount={player.bet} big={you} />
            </motion.span>
          )}
        </AnimatePresence>
        {winner && player ? (
          <motion.span
            initial={reduce ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 380, damping: 18 }}
            className="rounded-md bg-[linear-gradient(180deg,#ffe7a8,#e9b44c)] px-1.5 py-0.5 font-mono text-[0.58rem] font-black tabular-nums text-[#1a1204] shadow-lg @[40rem]:text-xs"
          >
            +{formatTokenAmount(BigInt(player.won - player.total))}
          </motion.span>
        ) : label && (
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono text-[0.52rem] font-bold uppercase tracking-wide @[40rem]:text-[0.62rem] ${
              player?.action === "fold"
                ? "bg-black/60 text-faint"
                : player?.action === "allin"
                  ? "bg-danger/85 text-white"
                  : player?.action === "raise" || player?.action === "bet"
                    ? "bg-gold text-ink"
                    : "bg-black/70 text-text"
            }`}
          >
            {label}
          </span>
        )}
      </div>
      <div
        className={`flex items-end justify-center transition-opacity ${faded || folded ? "opacity-40" : ""} ${you ? "min-h-[clamp(3.9rem,14.7cqw,7rem)]" : "min-h-[clamp(2.3rem,7.6cqw,4.2rem)]"}`}
        style={{ "--card": you ? CARD_WIDTH.front : CARD_WIDTH.seat } as React.CSSProperties}
      >
        {player &&
          !(folded && !you) &&
          [0, 1].map((index) => (
            // The viewer's own cards turn face up in place when they arrive; the others' turn over at the showdown.
            <span key={`${handId}-${index}-${you ? "mine" : (cards?.[index] ?? "down")}`} className={index > 0 ? OVERLAP : ""}>
              <PlayingCard
                card={cards?.[index] ?? null}
                entry={
                  cards && !you
                    ? { flip: true, delay: index * 0.12 }
                    : { ...fly, delay: dealIndex >= 0 ? (index * dealtCount + dealIndex) * 0.14 : 0 }
                }
                reduce={reduce}
              />
            </span>
          ))}
      </div>
      {showdown && player?.rank != null && (
        <span className={`-mt-0.5 whitespace-nowrap rounded-md px-1.5 text-[0.52rem] font-semibold @[40rem]:text-[0.62rem] ${winner ? "bg-gold text-ink" : "bg-black/70 text-muted"}`}>
          {rankName(player.rank)}
        </span>
      )}
      {name ? (
        <div
          className={`relative w-full min-w-0 overflow-hidden rounded-xl border px-1 pb-1.5 pt-1 text-center backdrop-blur-sm transition ${
            active
              ? "border-gold bg-gold/20 shadow-[0_0_22px_rgba(233,180,76,0.55)]"
              : winner
                ? "border-gold bg-[linear-gradient(180deg,rgba(233,180,76,0.3),rgba(0,0,0,0.7))] shadow-[0_0_24px_rgba(233,180,76,0.6)]"
                : seat?.highRoller
                  ? "border-gold/80 bg-[linear-gradient(180deg,rgba(233,180,76,0.22),rgba(0,0,0,0.7))] shadow-[0_0_16px_rgba(233,180,76,0.35)]"
                  : you
                    ? "border-gold/60 bg-black/65"
                    : "border-white/10 bg-black/55"
          } ${seat?.sittingOut ? "opacity-60" : ""}`}
        >
          {seat?.highRoller && (
            <span className="mb-0.5 flex items-center justify-center gap-1 font-mono text-[0.5rem] font-bold uppercase tracking-[0.14em] text-gold-bright @[40rem]:text-[0.58rem]" title="More than 1,000,000 game credit">
              <svg viewBox="0 0 24 24" className="size-2.5 @[40rem]:size-3" fill="currentColor" aria-hidden="true">
                <path d="M3 8l4.5 3.5L12 4l4.5 7.5L21 8l-2 11H5z" />
              </svg>
              High roller
            </span>
          )}
          <span className={`block truncate font-semibold ${you ? "text-xs @[40rem]:text-sm" : "text-[0.58rem] @[40rem]:text-xs"} ${you ? "text-gold-bright" : "text-text"}`} title={name}>
            {name}
          </span>
          <span className="block font-mono text-[0.52rem] tabular-nums text-faint @[40rem]:text-[0.62rem]">
            {seat ? (seat.sittingOut ? "sitting out" : formatTokenAmount(BigInt(seat.stack))) : "left"}
          </span>
          {/* The dealer button. */}
          {button && (
            <span className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-white font-mono text-[0.5rem] font-black text-ink shadow @[40rem]:size-5 @[40rem]:text-[0.6rem]" title="Dealer button">
              D
            </span>
          )}
          {/* The time this player has left for the decision, running down. */}
          {timeShare !== null && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
              <span className={`block h-full transition-[width] duration-300 ease-linear ${timeShare <= 0.15 ? "bg-[#ff4d4d]" : "bg-gold-bright"}`} style={{ width: `${Math.round(timeShare * 100)}%` }} />
            </span>
          )}
        </div>
      ) : canSit ? (
        <button
          type="button"
          onClick={onSit}
          className="grid h-[2.3rem] w-full place-items-center rounded-xl border border-dashed border-gold/40 bg-black/30 text-[0.6rem] font-semibold text-gold/80 transition hover:border-gold/70 hover:bg-gold/10 hover:text-gold-bright @[40rem]:text-xs"
          aria-label={`Sit at seat ${number}`}
        >
          + Sit · {number}
        </button>
      ) : (
        <span aria-label={`Seat ${number} is free`} className="grid size-8 place-items-center rounded-full border border-dashed border-white/15 font-mono text-[0.6rem] text-faint/70">
          {number}
        </span>
      )}
    </div>
  );
}
