"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatTokenAmount } from "@/lib/format";
import { canSplit, cardRank, cardSuit, cardValue, handTotal, SEATS, type BlackjackHand, type BlackjackRound, type BlackjackState, type BlackjackView, type Card } from "@/lib/game/blackjack";
import { aceArt, cardArt } from "@/lib/game/card-art";
import { SUIT_COLORS, SUIT_SYMBOLS } from "@/lib/game/card-race";
import { subscribeBroadcast } from "@/lib/realtime";
import { play } from "@/lib/sound";
import type { ArenaGame } from "./arena";
import { WinBurst } from "./arena-effects";
import { CardBack } from "./card-race-stage";
import { GatorFigure, type GatorMood } from "./gator-figure";
import { GameFrame, Kbd, useGameKeys, type GameToast } from "./game-frame";
import { GamePanel, type WalletPanels } from "./terminal";

type Move = "hit" | "stand" | "double" | "split";
type Reveal = { id: number; step: number; slow: boolean; balance: number };
/** Right after the dealer's turn: the round whose winnings are being paid out. */
type Payout = { id: number; landed: boolean };

type Props = {
  game: ArenaGame;
  bets: { min: number; max: number; step: number };
  enabled: boolean;
  load(table: number): Promise<BlackjackState>;
  sit(table: number, seat: number): Promise<BlackjackState>;
  /** One seat, or with null every seat of the player at the table. */
  leave(table: number, seat: number | null): Promise<BlackjackState>;
  bet(table: number, amount: number | null): Promise<BlackjackState>;
  act(table: number, move: Move): Promise<BlackjackState>;
  onSettled(): void;
  onBack(): void;
  wallet: WalletPanels;
};

// A clock for countdowns, in quarter seconds; no time before hydration.
const subscribeClock = (callback: () => void) => {
  const id = window.setInterval(callback, 250);
  return () => window.clearInterval(id);
};
const clockNow = () => Math.floor(Date.now() / 250) * 250;
const useClock = () => useSyncExternalStore(subscribeClock, clockNow, () => null);

/** The size of an element, kept up to date. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const RESULT_LABEL: Record<NonNullable<BlackjackHand["result"]>, string> = { win: "Win", blackjack: "Blackjack", push: "Push", lose: "Lose" };
const RESULT_STYLE: Record<NonNullable<BlackjackHand["result"]>, string> = {
  win: "bg-positive/90 text-[#062915]",
  blackjack: "bg-[linear-gradient(180deg,#ffe7a8,#e9b44c)] text-[#1a1204]",
  push: "bg-white/80 text-ink",
  lose: "bg-black/80 text-faint",
};

/**
 * Card widths. A card overlaps the one before by OVERLAP of its width, so the
 * corner index (rank and suit, about 0.5 of the width at most) always stays
 * free; the index scales with the card.
 */
const CARD_WIDTH = { seat: "clamp(1.75rem,5.6cqw,3.1rem)", front: "clamp(3rem,11.5cqw,5.4rem)", dealer: "clamp(2.4rem,9cqw,4.8rem)" } as const;
const OVERLAP = "-ml-[calc(var(--card)*0.42)]";

/** Seconds a countdown runs: to the deal, and per decision (see game.bj_step and game.bj_advance). */
const DEAL_SECONDS = 10;
const TURN_SECONDS = 20;

/**
 * The seven seats around the rail, seat 1 on the left to seat 7 on the right, as
 * [x, y] in % of the table: where a player's plate stands (their cards lie in
 * front of it, towards the dealer).
 */
const PLACES = {
  narrow: [
    [12, 39],
    [13, 61],
    [29, 81],
    [50, 97],
    [71, 81],
    [87, 61],
    [88, 39],
  ],
  wide: [
    [12, 47],
    [18, 67],
    [32, 82],
    [50, 97],
    [68, 82],
    [82, 67],
    [88, 47],
  ],
} as const;
/** Where the shoe stands; every card comes from there. */
const SHOE = [80, 7] as const;

/**
 * Blackjack for up to seven players at one table. Players take a seat and bet;
 * 10 seconds after the second bet the cards come. Each player has 20 seconds
 * per decision. The table moves on the server; this component shows what the
 * server pushes and sends the player's moves.
 */
export function BlackjackTable({ game, bets, enabled, load, sit, leave, bet, act, onSettled, onBack, wallet }: Props) {
  const reduce = useReducedMotion();
  const [table, setTable] = useState(1);
  const [view, setView] = useState<BlackjackState | null>(null);
  const [offset, setOffset] = useState(0);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chip, setChip] = useState(bets.min);
  // The round whose win burst has played (or was tapped away).
  const [burstSeen, setBurstSeen] = useState<number | null>(null);
  // The dealer's turn played back card by card (the server settles it at once): how many dealer cards are up.
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [felt, size] = useElementSize<HTMLDivElement>();
  const now = useClock();
  const settledRounds = useRef(new Set<number>());
  // Until when the deal's own card sounds play (the one-sound-per-update rule waits meanwhile).
  const dealSoundsUntil = useRef(0);
  const viewRef = useRef<BlackjackState | null>(null);
  const reduceRef = useRef(reduce);
  useEffect(() => {
    reduceRef.current = reduce;
  });

  // The server's answer and the server's clock (countdowns run on it). A round seen in play that comes
  // back finished starts the dealer's turn: a double knock, then the cards one by one.
  const receive = useCallback((next: BlackjackView, you?: BlackjackState["you"]) => {
    const previous = viewRef.current;
    // An answer that was read before the last push would turn the table back (a countdown would vanish):
    // the table stays as it is, only the player's own part (balance, seats) is taken.
    if (previous && previous.table === next.table && Date.parse(next.now) < Date.parse(previous.now)) {
      if (you) {
        const merged = { ...previous, you };
        viewRef.current = merged;
        setView(merged);
      }
      return;
    }
    setOffset(Date.parse(next.now) - Date.now());
    const before = previous?.round;
    const finished = next.round?.status === "done" ? next.round : next.last;
    if (before && before.status !== "done" && finished?.id === before.id && finished.hands.length && !reduceRef.current) {
      // An ace or a ten up: the dealer may hold blackjack, so it goes 1.5 times slower.
      const slow = finished.dealer[0] !== null && finished.dealer[0] !== undefined && cardValue(finished.dealer[0]) >= 10;
      setReveal({ id: finished.id, step: 1, slow, balance: previous.you.balance });
      play("knock");
    }
    // The deal: one card sound per card, in the rhythm the cards fly in.
    if (before?.status === "betting" && next.round?.id === before.id && next.round.status === "playing") {
      const cards = next.round.hands.filter((hand) => hand.part === 0).length * 2 + 2;
      for (let card = 0; card < cards; card += 1) window.setTimeout(() => play("flip"), 250 + card * 180);
      dealSoundsUntil.current = Date.now() + 600 + cards * 180;
    }
    const merged = { ...next, you: you ?? previous?.you ?? { seat: null, table: null, hands: [], balance: 0 } };
    viewRef.current = merged;
    setView(merged);
  }, []);
  const refresh = useCallback(
    () =>
      load(table).then(
        (state) => receive(state, state.you),
        (cause: unknown) => setError(cause instanceof Error ? cause.message : "The table could not be loaded."),
      ),
    [load, table, receive],
  );

  // First look, then live pushes; a heartbeat keeps the seat, and while the push channel is down the table is polled.
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeBroadcast<BlackjackView>(`blackjack-${table}`, "state", (payload) => receive(payload), setLive);
    const heartbeat = window.setInterval(() => void refresh(), 25_000);
    return () => {
      unsubscribe();
      window.clearInterval(heartbeat);
    };
  }, [table, refresh, receive]);
  useEffect(() => {
    if (live) return;
    const id = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(id);
  }, [live, refresh]);

  const round = view?.round ?? null;
  const serverNow = now === null ? null : now + offset;
  const deadline = round?.status === "betting" ? round.startsAt : round?.status === "playing" ? round.turnDeadline : null;
  // When a countdown runs out, ask the table to move on (the scheduled tick does it too, a little later).
  useEffect(() => {
    if (!deadline) return;
    const wait = Date.parse(deadline) - (Date.now() + offset) + 400;
    const id = window.setTimeout(() => void refresh(), Math.max(200, wait));
    return () => window.clearTimeout(id);
  }, [deadline, offset, refresh]);

  const you = view?.you ?? null;
  // An account may hold several seats at the table.
  const mySeats = you && you.table === table ? (you.seats ?? (you.seat !== null ? [you.seat] : [])) : [];
  const mySeat = mySeats[0] ?? null;
  const myName = view?.seats.find((seat) => seat.seat === mySeat)?.name ?? null;
  const mine = (hand: BlackjackHand) => !!you?.hands.includes(hand.id) || (mySeats.includes(hand.seat) && hand.name === myName);
  const turnHand = round?.status === "playing" ? (round.hands.find((hand) => hand.id === round.turnHand) ?? null) : null;
  const myTurn = !!turnHand && mine(turnHand);
  // The bets on the player's seats: placed when every seat carries one, the same on all.
  const myBets = (view?.seats ?? []).filter((seat) => mySeats.includes(seat.seat)).map((seat) => seat.bet);
  const seatBet = myBets.length && myBets.every((amount) => amount !== null && amount === myBets[0]) ? myBets[0] : myBets.some((amount) => amount !== null) ? -1 : null;
  const betTotal = chip * Math.max(1, mySeats.length);
  const betters = view?.seats.filter((seat) => seat.bet !== null).length ?? 0;
  const remaining = deadline && serverNow !== null ? Math.max(0, (Date.parse(deadline) - serverNow) / 1000) : null;
  const balance = you?.balance ?? 0;
  // While the dealer's cards turn, the balance stays where it was (the result is not out yet).
  const shownBalance = reveal ? reveal.balance : balance;

  // The last finished round this player had hands in: its result, shown while it is fresh (after the dealer's turn).
  const finished = round?.status === "done" ? round : (view?.last ?? null);
  const revealing = !!reveal && reveal.id === finished?.id;
  const revealTotal = revealing ? (finished?.dealer.length ?? 0) : 0;
  useEffect(() => {
    if (!reveal) return;
    const pace = reveal.slow ? 1.5 : 1;
    const delay = (reveal.step === 1 ? 900 : reveal.step < revealTotal ? 1000 : 900) * pace;
    const id = window.setTimeout(() => {
      if (reveal.step < revealTotal) {
        play("flip");
        setReveal({ ...reveal, step: reveal.step + 1 });
      } else {
        setReveal(null);
        // The dealer pays: chips go out to the winners, the Gator reacts.
        setPayout({ id: reveal.id, landed: false });
      }
    }, delay);
    return () => window.clearTimeout(id);
  }, [reveal, revealTotal]);
  const myFinished = finished ? finished.hands.filter(mine) : [];
  const outcome =
    finished && myFinished.length
      ? (() => {
          const staked = myFinished.reduce((sum, hand) => sum + hand.bet, 0);
          const paid = myFinished.reduce((sum, hand) => sum + hand.payout, 0);
          return { id: finished.id, paid, net: paid - staked, dealer: finished.dealerTotal };
        })()
      : null;
  const fresh = !revealing && !!outcome && !!finished?.finishedAt && serverNow !== null && serverNow - Date.parse(finished.finishedAt) < 30_000;
  const lastWin = !revealing && outcome && outcome.net > 0 ? outcome.paid : null;
  // After the chips have landed, short, and gone as soon as the next countdown starts.
  const burst =
    fresh && outcome && outcome.net > 0 && payout?.id === outcome.id && payout.landed && burstSeen !== outcome.id && !reduce && !round?.startsAt && round?.status !== "playing"
      ? outcome
      : null;
  // The payout lasts a few seconds: chips fly (about 1.4 s), the Gator grins or reels.
  useEffect(() => {
    if (!payout) return;
    const id = payout.landed ? window.setTimeout(() => setPayout(null), 3000) : window.setTimeout(() => setPayout({ ...payout, landed: true }), 1400);
    return () => window.clearTimeout(id);
  }, [payout]);
  const paying = !!payout && payout.id === finished?.id && round?.status !== "playing";
  const dealerMood: GatorMood = revealing
    ? "think"
    : paying && finished
      ? finished.dealerTotal > 21
        ? "bust"
        : finished.hands.filter((hand) => hand.result === "lose").length > finished.hands.filter((hand) => hand.result === "win" || hand.result === "blackjack").length
          ? "win"
          : "idle"
      : "idle";

  // Once per finished round, after the dealer's turn: the page's balance and history catch up.
  const outcomeId = revealing ? null : (outcome?.id ?? null);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });
  useEffect(() => {
    if (outcomeId === null || settledRounds.current.has(outcomeId)) return;
    settledRounds.current.add(outcomeId);
    onSettledRef.current();
    void refresh();
  }, [outcomeId, refresh]);

  // A card sound for every card that comes up.
  const shownCards = (round?.hands.reduce((sum, hand) => sum + hand.cards.length, 0) ?? 0) + (round?.dealer.filter((card) => card !== null).length ?? 0);
  const previousCards = useRef(shownCards);
  useEffect(() => {
    if (shownCards > previousCards.current && Date.now() > dealSoundsUntil.current) play("flip");
    previousCards.current = shownCards;
  }, [shownCards]);

  const run = async (task: () => Promise<BlackjackState>, sound?: Parameters<typeof play>[0]) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = await task();
      receive(state, state.you);
      if (sound) play(sound);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work. Try again.");
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const freeSeats = Array.from({ length: SEATS }, (_, index) => index + 1).filter((seat) => !view?.seats.some((taken) => taken.seat === seat));
  // The middle seats first: they see the whole table.
  const preferredSeat = [4, 3, 5, 2, 6, 1, 7].find((seat) => freeSeats.includes(seat)) ?? null;
  const takeSeat = (seat: number | null) => seat !== null && run(() => sit(table, seat), "click");
  // The chip goes on every seat the player holds.
  const placeBet = () => mySeat !== null && run(() => bet(table, chip), "chip");
  const clearBet = () => mySeat !== null && run(() => bet(table, null), "click");
  const move = (next: Move) => myTurn && run(() => act(table, next));
  const myTurnHand = myTurn ? turnHand : null;
  const canDouble = !!myTurnHand && myTurnHand.cards.length === 2 && balance >= myTurnHand.bet;
  const canSplitNow = !!myTurnHand && canSplit(myTurnHand) && balance >= myTurnHand.bet;
  const betting = round?.status === "betting";
  const handInPlay = round?.status === "playing" && round.hands.some(mine);
  const iAmIn = myBets.some((amount) => amount !== null) || handInPlay;

  useGameKeys({
    h: () => move("hit"),
    s: () => move("stand"),
    d: () => canDouble && move("double"),
    p: () => canSplitNow && move("split"),
    enter: () => (mySeat === null ? takeSeat(preferredSeat) : betting && seatBet !== chip ? placeBet() : undefined),
    up: () => setChip((value) => Math.min(bets.max, value + bets.step)),
    down: () => setChip((value) => Math.max(bets.min, value - bets.step)),
    plus: () => setChip((value) => Math.min(bets.max, value + bets.step)),
    minus: () => setChip((value) => Math.max(bets.min, value - bets.step)),
  });

  const prompt = !view
    ? "Loading the table…"
    : mySeat === null
      ? you?.table && you.table !== table
        ? `You sit at table ${you.table}`
        : freeSeats.length
          ? "Take a seat to play"
          : "This table is full"
      : myTurn
        ? `Your move${mySeats.length > 1 && turnHand ? ` at seat ${turnHand.seat}` : ""}: hit, stand, double or split`
        : round?.status === "playing"
          ? handInPlay
            ? `Waiting for ${turnHand?.name ?? "the table"}`
            : "This round is running · bet for the next one"
          : seatBet !== null
            ? betters < 2
              ? "Bet placed · waiting for a second player"
              : "Bet placed · the cards are coming"
            : betters >= 1
              ? `Place a bet to join · ${betters} ready`
              : "Place a bet · the round starts with two players";

  const toast: GameToast | null = error
    ? { id: `error-${error}`, text: error, tone: "error" }
    : outcome && fresh
      ? {
          id: `result-${outcome.id}`,
          text:
            outcome.net === 0
              ? "Push · bet back"
              : `${outcome.net > 0 ? "+" : "−"}${formatTokenAmount(BigInt(Math.abs(outcome.net)))} · dealer ${outcome.dealer > 21 ? "bust" : outcome.dealer}`,
          tone: outcome.net > 0 ? "win" : "info",
        }
      : !enabled
        ? { id: "paused", text: "Games are paused right now.", tone: "warn" }
        : null;

  const panel = (
    <GamePanel
      prompt={prompt}
      options={
        mySeat !== null || (view?.tables.length ?? 0) > 1 ? (
          <div className="flex items-center justify-between gap-2 text-xs text-faint">
            <span>
              {mySeat !== null ? (
                <>
                  {mySeats.length > 1 ? `Seats ${mySeats.join(", ")}` : `Seat ${mySeat}`} · <span className="font-semibold text-text">{myName}</span>
                </>
              ) : (
                `Table ${table}`
              )}
            </span>
            <span className="flex items-center gap-1">
              {(view?.tables.length ?? 0) > 1 &&
                view?.tables.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setTable(entry.id)}
                    className={`rounded-lg border px-2 py-1 font-semibold transition ${entry.id === table ? "border-gold/50 bg-gold/15 text-gold-bright" : "border-line text-muted hover:text-text"}`}
                    title={`Table ${entry.id} · ${entry.seated} seated`}
                  >
                    {entry.id}
                  </button>
                ))}
              {mySeat !== null && !handInPlay && (
                <button type="button" onClick={() => run(() => leave(table, null), "click")} className="rounded-lg border border-line px-2 py-1 font-semibold text-muted transition hover:border-danger/40 hover:text-danger">
                  {mySeats.length > 1 ? "Leave table" : "Leave seat"}
                </button>
              )}
            </span>
          </div>
        ) : undefined
      }
      bet={{ bets, bet: chip, onChange: setChip, disabled: mySeat === null || !betting, affordable: (amount) => amount * Math.max(1, mySeats.length) <= balance }}
      play={
        myTurn
          ? { label: "Hit", amount: myTurnHand?.bet, onPlay: () => move("hit"), playable: !busy, auto: "off", onAuto: () => undefined, lockable: false, tone: "green", kbd: <Kbd>H</Kbd> }
          : mySeat === null
            ? { label: "Take a seat", amount: chip, onPlay: () => takeSeat(preferredSeat), playable: preferredSeat !== null && !busy && enabled, auto: "off", onAuto: () => undefined, lockable: false, kbd: <Kbd>Enter</Kbd> }
            : {
                label: !betting
                  ? "Next round"
                  : seatBet === null
                    ? mySeats.length > 1
                      ? `Place bet × ${mySeats.length} seats`
                      : "Place bet"
                    : seatBet === chip
                      ? "Bet placed"
                      : "Change bet",
                amount: betTotal,
                onPlay: placeBet,
                playable: betting && seatBet !== chip && betTotal <= balance && !busy && enabled,
                auto: "off",
                onAuto: () => undefined,
                lockable: false,
                kbd: betting && seatBet !== chip ? <Kbd>Enter</Kbd> : null,
              }
      }
      side={
        myTurn ? (
          <button
            type="button"
            onClick={() => move("stand")}
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,var(--color-gold-bright),var(--color-gold))] px-3 font-bold text-[#1a1204] shadow-[0_10px_30px_-12px_rgba(233,180,76,0.8)] transition enabled:hover:brightness-110 disabled:opacity-45 lg:min-h-14 lg:rounded-2xl lg:text-lg"
          >
            Stand <Kbd>S</Kbd>
          </button>
        ) : undefined
      }
      below={
        myTurn ? (
          <div className="grid grid-cols-2 gap-2">
            <ActionButton label="Double" shortcut="D" onClick={() => move("double")} disabled={!canDouble || busy} />
            <ActionButton label="Split" shortcut="P" onClick={() => move("split")} disabled={!canSplitNow || busy} />
          </div>
        ) : undefined
      }
      extra={
        seatBet !== null && betting ? (
          <button type="button" onClick={clearBet} className="self-center text-xs text-faint hover:text-text">
            Take the bet back
          </button>
        ) : undefined
      }
      lastWin={lastWin}
      balance={shownBalance}
      wallet={wallet}
    />
  );

  const rules = (
    <>
      <span className="block">Up to seven players at a table, each against the dealer. A round starts 10 seconds after the second bet.</span>
      <span className="mt-2 block">20 seconds per decision; when the time runs out, the hand stands. Double on any two cards, split once.</span>
      <span className="mt-2 block">The dealer draws to 17 and stands on every 17. Blackjack pays 3:2, a win 1:1, a push returns the bet.</span>
      <span className="mt-2 block text-xs text-faint">
        Provably fair: the six-deck shoe is shuffled with HMAC-SHA256(server seed, &quot;client seeds of the players | joined:round:blackjack:n&quot;); the
        server seed is committed before the deal and revealed after the round.
      </span>
      {round && <span className="mt-2 block break-all font-mono text-[0.65rem] text-faint">Round {round.id} · seed hash {round.serverSeedHash}</span>}
      {view?.last?.serverSeed && (
        <span className="mt-1 block break-all font-mono text-[0.65rem] text-faint">
          Round {view.last.id} · seed {view.last.serverSeed} · client seeds {view.last.clientSeed}
        </span>
      )}
    </>
  );

  const shown: BlackjackRound | null = round && (round.status !== "betting" || !view?.last) ? round : (view?.last ?? round);
  const fading = round?.status === "betting" && shown !== round && !revealing;
  // While the dealer's turn plays back: the first cards up, the hole card down until its turn, later cards not yet drawn.
  const dealerCards = shown && revealing && reveal ? shown.dealer.flatMap((card, index) => (index < reveal.step ? [card] : index === 1 ? [null] : [])) : (shown?.dealer ?? []);
  const dealerTotal = revealing ? handTotal(dealerCards).total : (shown?.dealerTotal ?? 0);

  // The deal order: each hand's first card, the dealer's, then the second round (cards fly in one after the other).
  const dealt = (shown?.hands ?? []).filter((hand) => hand.part === 0).map((hand) => hand.seat);
  const places = size.width >= 640 ? PLACES.wide : PLACES.narrow;
  // From a place to the shoe, in pixels: where that place's cards come from.
  const fromShoe = (x: number, y: number) => ({ x: ((SHOE[0] - x) / 100) * size.width, y: ((SHOE[1] - y) / 100) * size.height + 40 });

  const clock =
    remaining !== null && round?.status === "betting" && round.startsAt
      ? { label: "Cards in", total: DEAL_SECONDS, urgent: false, audible: iAmIn }
      : remaining !== null && round?.status === "playing" && turnHand
        ? { label: myTurn ? "Your move" : turnHand.name, total: TURN_SECONDS, urgent: myTurn, audible: myTurn }
        : null;
  const status = revealing
    ? "Dealer plays"
    : !round
      ? "Opening the table…"
      : round.status === "betting" && !round.startsAt
        ? betters === 1
          ? "Waiting for a second player"
          : fading
            ? "Place your bets"
            : "Take a seat and bet · two players start a round"
        : null;

  return (
    <GameFrame gameId="blackjack" payoutBps={game.payoutBps} onBack={onBack} info={rules} panel={panel} toast={toast}>
      <div
        ref={felt}
        data-live={live ? "on" : "off"}
        className="@container relative h-full overflow-hidden bg-[radial-gradient(ellipse_at_50%_100%,#14100a,#050506_70%)] sm:rounded-2xl sm:border sm:border-gold/25"
      >
        <Felt />
        <Shoe />
        <Dealer
          mood={dealerMood}
          roundId={shown?.id ?? null}
          cards={dealerCards}
          total={dealerTotal}
          faded={fading}
          playing={revealing}
          slow={revealing && !!reveal?.slow && reveal.step === 1}
          dealtCount={dealt.length}
          reduce={!!reduce}
        />

        {/* The middle of the table: the countdown, or what the table is waiting for. */}
        <div className="absolute inset-x-0 top-[39%] z-20 flex -translate-y-1/2 flex-col items-center gap-2 px-3 text-center @[40rem]:top-[41%]">
          {clock && remaining !== null ? (
            <TableClock key={`${round?.id}-${round?.status}-${round?.turnHand}`} label={clock.label} remaining={remaining} total={clock.total} urgent={clock.urgent} audible={clock.audible} />
          ) : (
            status && (
              <p className="rounded-full border border-white/10 bg-black/45 px-3 py-1 text-xs font-semibold text-muted @[40rem]:text-sm">{status}</p>
            )
          )}
        </div>

        {Array.from({ length: SEATS }, (_, index) => {
          const number = index + 1;
          const [x, y] = places[index];
          const seat = view?.seats.find((entry) => entry.seat === number) ?? null;
          // Results stay hidden until the dealer's last card is up.
          const hands = (shown?.hands.filter((hand) => hand.seat === number) ?? []).map((hand) => (revealing ? { ...hand, result: null } : hand));
          const active = hands.find((hand) => hand.id === turnHand?.id) ?? null;
          return (
            <Place
              key={number}
              number={number}
              x={x}
              y={y}
              front={mySeats.includes(number)}
              name={seat?.name ?? (fading ? null : (hands[0]?.name ?? null))}
              pendingBet={seat?.bet ?? null}
              highRoller={!!seat?.highRoller}
              hands={hands}
              faded={fading}
              you={mySeats.includes(number)}
              onLeave={mySeats.length > 1 && !handInPlay ? () => run(() => leave(table, number), "click") : null}
              activeHand={active?.id ?? null}
              timeShare={active && remaining !== null ? remaining / TURN_SECONDS : null}
              // A free seat can be taken by anyone, also by a player who already sits here (one more hand).
              canSit={!seat && !busy && enabled && (mySeat === null || betting)}
              onSit={() => takeSeat(number)}
              fly={fromShoe(x, y)}
              dealIndex={dealt.indexOf(number)}
              dealtCount={dealt.length}
              reduce={!!reduce}
            />
          );
        })}

        {/* The dealer pays every winning hand: chips fly from the dealer to the player. */}
        {paying && finished && !reduce && (
          <Winnings
            key={finished.id}
            width={size.width}
            height={size.height}
            targets={finished.hands
              .filter((hand) => hand.payout > hand.bet)
              .map((hand) => ({ id: hand.id, x: places[hand.seat - 1][0], y: places[hand.seat - 1][1] - 12, chips: Math.min(7, 2 + Math.floor((hand.payout - hand.bet) / 600)) }))}
          />
        )}

        <AnimatePresence>
          {burst && <WinBurst key={burst.id} amount={burst.paid} duration={1800} onDone={() => setBurstSeen(burst.id)} />}
        </AnimatePresence>
        <p className="sr-only" aria-live="polite">
          {prompt}
        </p>
      </div>
    </GameFrame>
  );
}

/** Double and split, under Stand and Hit. */
function ActionButton({ label, shortcut, onClick, disabled }: { label: string; shortcut: string; onClick(): void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-white/[0.04] px-2 text-sm font-semibold text-text transition enabled:hover:border-gold/50 enabled:hover:text-gold-bright disabled:opacity-35 lg:min-h-12"
    >
      {label} <Kbd>{shortcut}</Kbd>
    </button>
  );
}

/**
 * The table: green cloth with a leather rail and a gold line along the players'
 * edge, the rules printed in an arc, and a slow light passing over the cloth.
 */
function Felt() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute bottom-[2%] left-[-22%] right-[-22%] top-[-70%] rounded-[50%] bg-[radial-gradient(ellipse_at_50%_70%,#1d6342_0%,#124a31_42%,#0b2f1f_78%)] shadow-[0_0_0_9px_#1f150c,0_0_0_11px_rgba(233,180,76,0.6),0_0_0_13px_#120c07,0_30px_70px_rgba(0,0,0,0.75)]" />
      <div className="absolute inset-0 bg-[linear-gradient(105deg,transparent_38%,rgba(255,255,255,0.06)_50%,transparent_62%)] bg-[length:260%_100%] animate-felt-sheen motion-reduce:animate-none" />
      <svg viewBox="0 0 200 60" className="absolute left-[30%] top-[51%] h-[10%] w-[40%] overflow-visible" preserveAspectRatio="xMidYMid meet">
        <defs>
          <path id="bj-arc-1" d="M 18 10 Q 100 52 182 10" />
          <path id="bj-arc-2" d="M 30 24 Q 100 62 170 24" />
        </defs>
        <text fill="rgba(233,180,76,0.6)" fontSize="8.5" fontWeight="700" letterSpacing="2.4" style={{ fontFamily: "var(--font-mono)" }}>
          <textPath href="#bj-arc-1" startOffset="50%" textAnchor="middle">
            BLACKJACK PAYS 3 TO 2
          </textPath>
        </text>
        <text fill="rgba(233,180,76,0.38)" fontSize="5.5" letterSpacing="1.6" style={{ fontFamily: "var(--font-mono)" }}>
          <textPath href="#bj-arc-2" startOffset="50%" textAnchor="middle">
            DEALER STANDS ON 17
          </textPath>
        </text>
      </svg>
    </div>
  );
}

/** The shoe the cards come from, at the dealer's right. */
function Shoe() {
  return (
    <div aria-hidden="true" className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rotate-[-10deg]" style={{ left: `${SHOE[0]}%`, top: `${SHOE[1] + 4}%` }}>
      <div className="relative aspect-[5/7] w-[clamp(1.8rem,6.5cqw,3.4rem)]">
        <CardBack className="absolute inset-0 translate-x-[3px] translate-y-[3px] opacity-60" />
        <CardBack className="absolute inset-0 translate-x-[1.5px] translate-y-[1.5px] opacity-80" />
        <CardBack className="absolute inset-0 shadow-lg shadow-black/70" />
      </div>
    </div>
  );
}

/** The dealer: the Gator behind the table, the dealer's cards on the cloth in front of him. */
function Dealer({
  mood,
  roundId,
  cards,
  total,
  faded,
  playing,
  slow,
  dealtCount,
  reduce,
}: {
  mood: GatorMood;
  roundId: number | null;
  cards: (Card | null)[];
  total: number;
  faded: boolean;
  playing: boolean;
  slow: boolean;
  dealtCount: number;
  reduce: boolean;
}) {
  return (
    <div data-dealer-up={cards.filter((card) => card !== null).length} className="absolute left-1/2 top-[1%] z-10 flex -translate-x-1/2 flex-col items-center">
      <div className="relative w-[clamp(5.5rem,24cqw,10rem)]" role="img" aria-label="The dealer: the Gator, DEGEN #007">
        {playing && <span className="absolute inset-[10%] rounded-full bg-gold/30 blur-2xl" />}
        <GatorFigure mood={mood} className="relative w-full drop-shadow-[0_10px_14px_rgba(0,0,0,0.55)]" />
      </div>
      <p className="-mt-[4%] flex items-center gap-1.5 rounded-full border border-gold/40 bg-black/75 px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.2em] text-gold-bright shadow-lg">
        Dealer
        {cards.length > 0 && <TotalPill total={total} />}
        {slow && <span className="animate-pulse rounded-full bg-gold/25 px-1.5 tracking-normal">Blackjack?</span>}
      </p>
      <div
        className={`mt-1 flex h-[clamp(3.2rem,12cqw,6.6rem)] items-center transition-opacity ${faded ? "opacity-45" : ""}`}
        style={{ "--card": CARD_WIDTH.dealer } as React.CSSProperties}
      >
        {cards.map((card, index) => (
          <span key={`${roundId}-${index}-${card === null ? "down" : "up"}`} className={index > 0 ? OVERLAP : ""}>
            <PlayingCard
              card={card}
              // The hole card turns over in place; every other card comes from the shoe.
              entry={index === 1 && card !== null ? { flip: true } : { x: 160, y: -10, delay: index < 2 && !playing ? (index * (dealtCount + 1) + dealtCount) * 0.18 : 0 }}
              reduce={reduce}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The countdown in the middle of the table: a ring that runs down, and the last
 * three seconds one by one in big numbers.
 */
function TableClock({ label, remaining, total, urgent, audible }: { label: string; remaining: number; total: number; urgent: boolean; audible: boolean }) {
  const seconds = Math.ceil(remaining);
  const final = remaining > 0 && seconds <= 3 ? seconds : null;
  const circumference = 2 * Math.PI * 44;
  const share = Math.max(0, Math.min(1, remaining / total));
  useEffect(() => {
    if (final !== null && audible) play("tick");
  }, [final, audible]);
  const color = urgent ? "var(--color-gold-bright)" : "var(--color-gold)";
  const growth = final === null ? 1 : [1.7, 1.35, 1][final - 1];
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`relative grid size-[clamp(3.6rem,13cqw,5.4rem)] place-items-center transition-opacity duration-200 ${final !== null ? "opacity-0" : ""}`}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
          <circle cx="50" cy="50" r="44" fill="rgba(0,0,0,0.55)" stroke="rgba(255,255,255,0.1)" strokeWidth="7" />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - share)}
            className="transition-[stroke-dashoffset,stroke] duration-300 ease-linear"
            style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          />
        </svg>
        <span className="relative font-mono text-[clamp(1.1rem,4.4cqw,1.7rem)] font-bold tabular-nums" style={{ color }}>
          {seconds}
        </span>
      </div>
      <p
        className={`max-w-[60cqw] truncate rounded-full border px-3 py-0.5 text-xs font-semibold transition-opacity @[40rem]:text-sm ${final !== null ? "opacity-0" : ""} ${
          urgent ? "border-gold bg-gold/20 text-gold-bright shadow-[0_0_24px_rgba(233,180,76,0.4)]" : "border-gold/30 bg-black/55 text-gold-bright"
        }`}
      >
        {label}
      </p>
      {/* The last three seconds, one by one, big. */}
      <AnimatePresence>
        {final !== null && (
          <motion.span
            key={final}
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 font-mono font-black tabular-nums text-[clamp(3rem,15cqw,6.5rem)] leading-none [text-shadow:0_0_30px_rgba(233,180,76,0.75),0_6px_0_rgba(0,0,0,0.6)]"
            style={{ color }}
            initial={{ opacity: 0, scale: growth * 0.4, x: "-50%", y: "-50%" }}
            animate={{ opacity: 1, scale: growth, x: "-50%", y: "-50%" }}
            exit={{ opacity: 0, scale: 0.5, x: "-50%", y: "-50%" }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
          >
            {final}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Chips flying from the dealer to each winning hand, a few per hand, one after another. */
function Winnings({ width, height, targets }: { width: number; height: number; targets: { id: number; x: number; y: number; chips: number }[] }) {
  const from = { x: 50, y: 32 };
  // One chip sound per winning hand, as its chips land (the targets of a round do not change).
  const winners = targets.length;
  useEffect(() => {
    const timers = Array.from({ length: winners }, (_, index) => window.setTimeout(() => play("chip"), 450 + index * 260));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [winners]);
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-40">
      {targets.flatMap((target, order) =>
        Array.from({ length: target.chips }, (_, index) => (
          <motion.span
            key={`${target.id}-${index}`}
            className="absolute size-[clamp(0.9rem,3.4cqw,1.5rem)] rounded-full border-2 border-dashed border-[#1a1204]/45 bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] shadow-[0_3px_8px_rgba(0,0,0,0.6)]"
            style={{ left: `${from.x}%`, top: `${from.y}%` }}
            initial={{ x: "-50%", y: "-50%", opacity: 0, scale: 0.6 }}
            animate={{
              x: [`-50%`, `calc(-50% + ${((target.x - from.x) / 100) * width + (index % 3) * 4 - 4}px)`],
              y: [`-50%`, `calc(-50% + ${((target.y - from.y) / 100) * height - index * 3}px)`],
              opacity: [0, 1, 1, 0],
              scale: [0.6, 1, 1, 0.9],
            }}
            transition={{ duration: 1.1, delay: 0.25 + order * 0.26 + index * 0.07, ease: [0.22, 1, 0.36, 1], times: [0, 0.75, 0.9, 1] }}
          />
        )),
      )}
    </div>
  );
}

/** One place at the rail: the player's plate, their bet and their cards on the cloth in front of it. */
function Place({
  number,
  x,
  y,
  front,
  name,
  pendingBet,
  hands,
  faded,
  you,
  activeHand,
  timeShare,
  canSit,
  onSit,
  fly,
  dealIndex,
  dealtCount,
  reduce,
  highRoller,
  onLeave,
}: {
  number: number;
  /** Leaves just this seat (a player holding several). */
  onLeave: (() => void) | null;
  x: number;
  y: number;
  /** The viewer's own seat: bigger cards. */
  front: boolean;
  name: string | null;
  pendingBet: number | null;
  highRoller: boolean;
  hands: BlackjackHand[];
  faded: boolean;
  you: boolean;
  activeHand: number | null;
  /** While it is this place's turn: the share of the decision time left. */
  timeShare: number | null;
  canSit: boolean;
  onSit(): void;
  fly: { x: number; y: number };
  dealIndex: number;
  dealtCount: number;
  reduce: boolean;
}) {
  const active = activeHand !== null;
  return (
    <div
      className={`absolute flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 ${front ? "z-20 w-[clamp(5.2rem,21cqw,10rem)]" : "z-10 w-[clamp(4rem,16cqw,7.5rem)]"}`}
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {/* The cloth in front of the player: cards, or the chip of a bet for the next deal. */}
      <div className={`flex items-end justify-center gap-2.5 transition-opacity ${faded ? "opacity-45" : ""} ${front ? "min-h-[clamp(3.8rem,13cqw,7rem)]" : "min-h-[clamp(2.6rem,9cqw,4.6rem)]"}`}>
        {/* A bet for the next deal shows over the faded cards of the last round. */}
        {hands.length && !(faded && pendingBet !== null) ? (
          hands.map((hand) => (
            <Hand
              key={hand.id}
              hand={hand}
              front={front}
              active={hand.id === activeHand}
              waiting={activeHand !== null && hand.id !== activeHand}
              fly={fly}
              dealIndex={dealIndex}
              dealtCount={dealtCount}
              reduce={reduce}
            />
          ))
        ) : pendingBet !== null ? (
          <motion.span initial={reduce ? false : { y: 24, opacity: 0, scale: 0.6 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 320, damping: 20 }}>
            <Chip amount={pendingBet} big={front} />
          </motion.span>
        ) : null}
      </div>
      {name ? (
        <div
          className={`relative w-full min-w-0 overflow-hidden rounded-xl border px-1 pb-1.5 pt-1 text-center backdrop-blur-sm transition ${
            active
              ? "border-gold bg-gold/20 shadow-[0_0_22px_rgba(233,180,76,0.55)]"
              : highRoller
                ? "border-gold/80 bg-[linear-gradient(180deg,rgba(233,180,76,0.22),rgba(0,0,0,0.7))] shadow-[0_0_16px_rgba(233,180,76,0.35)]"
                : you
                  ? "border-gold/60 bg-black/65"
                  : "border-white/10 bg-black/55"
          }`}
        >
          {highRoller && (
            <span className="mb-0.5 flex items-center justify-center gap-1 font-mono text-[0.5rem] font-bold uppercase tracking-[0.14em] text-gold-bright @[40rem]:text-[0.58rem]" title="More than 1,000,000 game credit">
              <svg viewBox="0 0 24 24" className="size-2.5 @[40rem]:size-3" fill="currentColor" aria-hidden="true">
                <path d="M3 8l4.5 3.5L12 4l4.5 7.5L21 8l-2 11H5z" />
              </svg>
              High roller
            </span>
          )}
          <span className={`block truncate font-semibold ${front ? "text-xs @[40rem]:text-sm" : "text-[0.58rem] @[40rem]:text-xs"} ${you ? "text-gold-bright" : "text-text"}`} title={name}>
            {name}
          </span>
          <span className="block font-mono text-[0.52rem] text-faint @[40rem]:text-[0.6rem]">{you ? `you · seat ${number}` : `seat ${number}`}</span>
          {onLeave && (
            <button
              type="button"
              onClick={onLeave}
              aria-label={`Leave seat ${number}`}
              title={`Leave seat ${number}`}
              className="absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full text-[0.6rem] text-faint transition hover:bg-danger/20 hover:text-danger"
            >
              ×
            </button>
          )}
          {/* The time this player has left for the decision, running down. */}
          {timeShare !== null && (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
              <span
                className={`block h-full transition-[width] duration-300 ease-linear ${timeShare <= 0.15 ? "bg-[#ff4d4d]" : "bg-gold-bright"}`}
                style={{ width: `${Math.round(timeShare * 100)}%` }}
              />
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
        // An empty seat while the viewer sits elsewhere: just its place at the rail.
        <span aria-label={`Seat ${number} is free`} className="grid size-8 place-items-center rounded-full border border-dashed border-white/15 font-mono text-[0.6rem] text-faint/70">
          {number}
        </span>
      )}
    </div>
  );
}

/** While it is a hand's turn its cards glow and pulse; the other hand of a split waits dimmed. */
const GLOW = ["0 0 0 2px rgba(233,180,76,0.9), 0 0 12px 2px rgba(233,180,76,0.45)", "0 0 0 3px rgba(255,215,121,1), 0 0 30px 8px rgba(233,180,76,0.85)"];

function Hand({
  hand,
  front,
  active,
  waiting,
  fly,
  dealIndex,
  dealtCount,
  reduce,
}: {
  hand: BlackjackHand;
  front: boolean;
  active: boolean;
  /** The other hand of a split is playing. */
  waiting: boolean;
  fly: { x: number; y: number };
  dealIndex: number;
  dealtCount: number;
  reduce: boolean;
}) {
  return (
    <motion.div
      className={`relative flex flex-col items-center transition-opacity duration-300 ${active ? "z-10" : ""} ${waiting ? "opacity-50 saturate-50" : ""}`}
      animate={{ scale: active ? 1.06 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
    >
      <TotalPill total={hand.total} bust={hand.status === "bust"} blackjack={hand.status === "blackjack"} active={active} />
      <motion.div
        className="mt-0.5 flex rounded-md"
        style={{ "--card": front ? CARD_WIDTH.front : CARD_WIDTH.seat } as React.CSSProperties}
        animate={active ? { boxShadow: reduce ? GLOW[1] : [GLOW[0], GLOW[1], GLOW[0]] } : { boxShadow: "0 0 0 0 rgba(0,0,0,0)" }}
        transition={active && !reduce ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
      >
        {hand.cards.map((card, index) => (
          <span key={`${index}-${card}`} className={index > 0 ? OVERLAP : ""}>
            <PlayingCard
              card={card}
              // The first two cards come in the order of the deal; later ones at once.
              entry={{ ...fly, delay: index < 2 && hand.part === 0 && dealIndex >= 0 ? (index * (dealtCount + 1) + dealIndex) * 0.18 : 0 }}
              reduce={reduce}
            />
          </span>
        ))}
      </motion.div>
      <span className="mt-1">
        <Chip amount={hand.bet} doubled={hand.doubled} big={front} />
      </span>
      {hand.result && (
        <motion.span
          className={`absolute left-1/2 top-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[0.6rem] font-bold uppercase shadow-lg @[40rem]:text-xs ${RESULT_STYLE[hand.result]}`}
          initial={reduce ? false : { scale: 0.4, opacity: 0, x: "-50%", y: "-50%" }}
          animate={{ scale: 1, opacity: 1, x: "-50%", y: "-50%" }}
          transition={{ type: "spring", stiffness: 380, damping: 18 }}
        >
          {RESULT_LABEL[hand.result]}
          {hand.payout > hand.bet ? ` +${formatTokenAmount(BigInt(hand.payout - hand.bet))}` : ""}
        </motion.span>
      )}
    </motion.div>
  );
}

/** A gold chip with the amount on it. */
function Chip({ amount, doubled, big }: { amount: number; doubled?: boolean; big?: boolean }) {
  return (
    <span
      className={`grid place-items-center rounded-full border-2 border-dashed border-[#1a1204]/45 bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] font-mono font-bold tabular-nums text-[#1a1204] shadow-[0_3px_8px_rgba(0,0,0,0.6)] ${
        big ? "h-7 min-w-12 px-1.5 text-[0.68rem]" : "h-5 min-w-9 px-1 text-[0.55rem]"
      }`}
    >
      {formatTokenAmount(BigInt(amount))}
      {doubled ? " ×2" : ""}
    </span>
  );
}

function TotalPill({ total, bust, blackjack, active }: { total: number; bust?: boolean; blackjack?: boolean; active?: boolean }) {
  return (
    <span
      className={`rounded-full px-1.5 font-mono text-[0.6rem] font-bold tabular-nums @[40rem]:text-[0.68rem] ${
        bust ? "bg-danger/90 text-white" : blackjack ? "bg-gold text-ink" : active ? "bg-gold-bright text-ink shadow-[0_0_12px_rgba(233,180,76,0.8)]" : "bg-black/75 text-text"
      }`}
    >
      {blackjack ? "BJ" : total}
    </span>
  );
}

/**
 * A card of the 300 deck with its index (rank and suit) in the corner; null is
 * face down. It flies in from the shoe (`x`, `y`: the shoe as seen from the
 * card's place) or, for the dealer's hole card, turns over in place.
 */
function PlayingCard({
  card,
  entry,
  reduce,
}: {
  card: Card | null;
  entry: { x: number; y: number; delay: number } | { flip: true };
  reduce: boolean;
}) {
  // The width comes from --card, set by the row of cards (see CARD_WIDTH).
  const width = "w-[var(--card)]";
  const initial = reduce ? false : "flip" in entry ? { rotateY: 90, opacity: 0.4 } : { x: entry.x, y: entry.y, rotate: -24, scale: 0.7, opacity: 0 };
  const transition = "flip" in entry ? { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } : { type: "spring" as const, stiffness: 170, damping: 22, delay: entry.delay };
  if (card === null) {
    return (
      <motion.span className={`relative block aspect-[5/7] ${width}`} initial={initial} animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }} transition={transition}>
        <CardBack className="absolute inset-0 shadow-md shadow-black/60" />
      </motion.span>
    );
  }
  const suit = cardSuit(card);
  const rank = cardRank(card);
  const art = rank === "A" ? aceArt(suit) : cardArt(suit, rank);
  return (
    <motion.span
      className={`relative block aspect-[5/7] overflow-hidden rounded-[12%/9%] bg-[linear-gradient(145deg,#ffe7a8,#e9b44c_42%,#a8691c)] p-[5%] shadow-md shadow-black/60 ${width}`}
      initial={initial}
      animate={{ x: 0, y: 0, rotate: 0, rotateY: 0, scale: 1, opacity: 1 }}
      transition={transition}
    >
      <span className="relative block size-full overflow-hidden rounded-[9%/7%]" style={{ backgroundColor: SUIT_COLORS[suit] }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art.src} alt={`${rank}${SUIT_SYMBOLS[suit]}`} className="absolute inset-0 size-full object-cover" style={{ objectPosition: "50% 30%" }} />
        {/* The corner index stays within the part of the card the next one leaves free. */}
        <span className="absolute left-0 top-0 flex flex-col items-center rounded-br-md bg-black/80 px-[calc(var(--card)*0.03)] py-[calc(var(--card)*0.02)] leading-none">
          <span className="text-[max(0.5rem,calc(var(--card)*0.27))] font-black tracking-tighter text-gold-bright">{rank}</span>
          <span className="text-[max(0.45rem,calc(var(--card)*0.22))]" style={{ color: SUIT_COLORS[suit] }}>
            {SUIT_SYMBOLS[suit]}
          </span>
        </span>
      </span>
    </motion.span>
  );
}
