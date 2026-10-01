"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatTokenAmount } from "@/lib/format";
import { canSplit, cardRank, cardSuit, SEATS, type BlackjackHand, type BlackjackRound, type BlackjackState, type BlackjackView, type Card } from "@/lib/game/blackjack";
import { aceArt, cardArt } from "@/lib/game/card-art";
import { SUIT_COLORS, SUIT_SYMBOLS } from "@/lib/game/card-race";
import { subscribeBroadcast } from "@/lib/realtime";
import { play } from "@/lib/sound";
import type { ArenaGame } from "./arena";
import { WinBurst } from "./arena-effects";
import { CardBack } from "./card-race-stage";
import { GameFrame, Kbd, useGameKeys, type GameToast } from "./game-frame";
import { GamePanel, type WalletPanels } from "./terminal";

type Move = "hit" | "stand" | "double" | "split";

type Props = {
  game: ArenaGame;
  bets: { min: number; max: number; step: number };
  enabled: boolean;
  load(table: number): Promise<BlackjackState>;
  sit(table: number, seat: number): Promise<BlackjackState>;
  leave(table: number): Promise<BlackjackState>;
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

const RESULT_LABEL: Record<NonNullable<BlackjackHand["result"]>, string> = { win: "Win", blackjack: "Blackjack", push: "Push", lose: "Lose" };
const RESULT_STYLE: Record<NonNullable<BlackjackHand["result"]>, string> = {
  win: "bg-positive/90 text-[#062915]",
  blackjack: "bg-[linear-gradient(180deg,#ffe7a8,#e9b44c)] text-[#1a1204]",
  push: "bg-white/80 text-ink",
  lose: "bg-black/80 text-faint",
};

/** Where the seven seats sit on the table's arc (seat 1 on the dealer's left, the player's right). */
const ARC = Array.from({ length: SEATS }, (_, index) => {
  const angle = ((14 + index * 25.3) * Math.PI) / 180;
  return { left: 50 + 43 * Math.cos(angle), top: 6 + 66 * Math.sin(angle) };
});

/**
 * Blackjack for up to seven players at one table. Players take a seat and bet;
 * 15 seconds after the second bet the cards come. Each player has 20 seconds
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
  const now = useClock();
  const settledRounds = useRef(new Set<number>());

  // The server's answer and the server's clock (countdowns run on it).
  const receive = useCallback((next: BlackjackView, you?: BlackjackState["you"]) => {
    setOffset(Date.parse(next.now) - Date.now());
    setView((current) => ({ ...next, you: you ?? current?.you ?? { seat: null, table: null, hands: [], balance: 0 } }));
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
  const mySeat = you && you.table === table ? you.seat : null;
  const myName = view?.seats.find((seat) => seat.seat === mySeat)?.name ?? null;
  const mine = (hand: BlackjackHand) => !!you?.hands.includes(hand.id) || (hand.seat === mySeat && hand.name === myName);
  const turnHand = round?.status === "playing" ? (round.hands.find((hand) => hand.id === round.turnHand) ?? null) : null;
  const myTurn = !!turnHand && mine(turnHand);
  const seatBet = view?.seats.find((seat) => seat.seat === mySeat)?.bet ?? null;
  const betters = view?.seats.filter((seat) => seat.bet !== null).length ?? 0;
  const secondsLeft = deadline && serverNow !== null ? Math.max(0, Math.ceil((Date.parse(deadline) - serverNow) / 1000)) : null;
  const balance = you?.balance ?? 0;

  // The last finished round this player had hands in: its result, shown while it is fresh.
  const finished = round?.status === "done" ? round : (view?.last ?? null);
  const myFinished = finished ? finished.hands.filter(mine) : [];
  const outcome =
    finished && myFinished.length
      ? (() => {
          const staked = myFinished.reduce((sum, hand) => sum + hand.bet, 0);
          const paid = myFinished.reduce((sum, hand) => sum + hand.payout, 0);
          return { id: finished.id, paid, net: paid - staked, dealer: finished.dealerTotal };
        })()
      : null;
  const fresh = !!outcome && !!finished?.finishedAt && serverNow !== null && serverNow - Date.parse(finished.finishedAt) < 15_000;
  const lastWin = outcome && outcome.net > 0 ? outcome.paid : null;
  const burst = fresh && outcome && outcome.net > 0 && burstSeen !== outcome.id && !reduce ? outcome : null;

  // Once per finished round: the page's balance and history catch up.
  const outcomeId = outcome?.id ?? null;
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
    if (shownCards > previousCards.current) play("flip");
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
  const placeBet = () => mySeat !== null && run(() => bet(table, chip), "chip");
  const clearBet = () => mySeat !== null && run(() => bet(table, null), "click");
  const move = (next: Move) => myTurn && run(() => act(table, next));
  const myTurnHand = myTurn ? turnHand : null;
  const canDouble = !!myTurnHand && myTurnHand.cards.length === 2 && balance >= myTurnHand.bet;
  const canSplitNow = !!myTurnHand && canSplit(myTurnHand) && balance >= myTurnHand.bet;
  const betting = round?.status === "betting";
  const handInPlay = round?.status === "playing" && round.hands.some(mine);

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
        ? `Your move · ${secondsLeft ?? ""}s`
        : round?.status === "playing"
          ? handInPlay
            ? `Waiting for ${turnHand?.name ?? "the table"}`
            : "This round is running · bet for the next one"
          : seatBet !== null
            ? betters < 2
              ? "Bet placed · waiting for a second player"
              : `Bet placed · cards in ${secondsLeft ?? ""}s`
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

  const actionButton = (label: string, key: string, onClick: () => void, enabledButton: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabledButton || busy}
      className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-white/[0.04] px-2 text-sm font-semibold text-text transition enabled:hover:border-gold/50 enabled:hover:text-gold-bright disabled:opacity-35 lg:min-h-12"
    >
      {label} <Kbd>{key}</Kbd>
    </button>
  );

  const panel = (
    <GamePanel
      prompt={prompt}
      options={
        mySeat !== null || (view?.tables.length ?? 0) > 1 ? (
          <div className="flex items-center justify-between gap-2 text-xs text-faint">
            <span>
              {mySeat !== null ? (
                <>
                  Seat {mySeat} · <span className="font-semibold text-text">{myName}</span>
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
                <button type="button" onClick={() => run(() => leave(table), "click")} className="rounded-lg border border-line px-2 py-1 font-semibold text-muted transition hover:border-danger/40 hover:text-danger">
                  Leave seat
                </button>
              )}
            </span>
          </div>
        ) : undefined
      }
      bet={{ bets, bet: chip, onChange: setChip, disabled: mySeat === null || !betting, affordable: (amount) => amount <= balance }}
      play={
        myTurn
          ? { label: "Stand", amount: myTurnHand?.bet, onPlay: () => move("stand"), playable: !busy, auto: "off", onAuto: () => undefined, lockable: false, kbd: <Kbd>S</Kbd> }
          : mySeat === null
            ? { label: "Take a seat", amount: chip, onPlay: () => takeSeat(preferredSeat), playable: preferredSeat !== null && !busy && enabled, auto: "off", onAuto: () => undefined, lockable: false, kbd: <Kbd>Enter</Kbd> }
            : {
                label: !betting ? "Next round" : seatBet === null ? "Place bet" : seatBet === chip ? "Bet placed" : "Change bet",
                amount: chip,
                onPlay: placeBet,
                playable: betting && seatBet !== chip && chip <= balance && !busy && enabled,
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
            onClick={() => move("hit")}
            disabled={busy}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#5ee39b,#1f9d5c)] px-3 font-bold text-[#062915] shadow-[0_10px_30px_-12px_rgba(94,227,155,0.7)] transition enabled:hover:brightness-110 disabled:opacity-45 lg:min-h-14 lg:rounded-2xl lg:text-lg"
          >
            Hit <Kbd>H</Kbd>
          </button>
        ) : undefined
      }
      below={
        myTurn ? (
          <div className="grid grid-cols-2 gap-2">
            {actionButton("Double", "D", () => move("double"), canDouble)}
            {actionButton("Split", "P", () => move("split"), canSplitNow)}
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
      balance={balance}
      wallet={wallet}
    />
  );

  const rules = (
    <>
      <span className="block">Up to seven players at a table, each against the dealer. A round starts 15 seconds after the second bet.</span>
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
  const fading = round?.status === "betting" && shown !== round;

  return (
    <GameFrame gameId="blackjack" payoutBps={game.payoutBps} onBack={onBack} info={rules} panel={panel} toast={toast}>
      <div
        data-live={live ? "on" : "off"}
        className="@container relative flex h-full flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_0%,#123726_0%,#0a1f15_45%,#050a07_100%)] sm:rounded-2xl sm:border sm:border-gold/25"
      >
        {/* The rim and the printed rules of the table. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-[4%] bottom-[-55%] top-[18%] hidden rounded-[50%] border border-gold/25 shadow-[inset_0_0_80px_rgba(0,0,0,0.5)] @[40rem]:block" />

        <Dealer round={shown} faded={fading} />

        <div className="relative z-10 flex min-h-12 flex-1 flex-col items-center justify-center gap-1 px-3 text-center">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.22em] text-gold/60 @[40rem]:text-[0.66rem]">Blackjack pays 3 to 2 · Dealer stands on 17</p>
          <Banner round={round} betters={betters} secondsLeft={secondsLeft} turnName={turnHand?.name ?? null} myTurn={myTurn} fading={fading} />
        </div>

        <div className="relative z-10 grid shrink-0 grid-cols-4 gap-1 px-1.5 pb-2 @[40rem]:block @[40rem]:h-[52%] @[40rem]:px-0 @[40rem]:pb-0">
          {ARC.map((place, index) => {
            const number = index + 1;
            const seat = view?.seats.find((entry) => entry.seat === number) ?? null;
            const hands = shown?.hands.filter((hand) => hand.seat === number) ?? [];
            return (
              <Seat
                key={number}
                number={number}
                place={place}
                // An empty seat is free to take; only a hand still in play keeps its player's name there.
                name={seat?.name ?? (fading ? null : (hands[0]?.name ?? null))}
                pendingBet={seat?.bet ?? null}
                hands={hands}
                faded={fading}
                you={number === mySeat}
                turnHandId={round?.status === "playing" ? round.turnHand : null}
                secondsLeft={secondsLeft}
                canSit={!seat && mySeat === null && !busy && enabled}
                onSit={() => takeSeat(number)}
              />
            );
          })}
        </div>

        <AnimatePresence>
          {burst && <WinBurst key={burst.id} amount={burst.paid} onDone={() => setBurstSeen(burst.id)} />}
        </AnimatePresence>
        <p className="sr-only" aria-live="polite">
          {prompt}
        </p>
      </div>
    </GameFrame>
  );
}

/** The dealer's cards at the top of the table, the hole card face down while players decide. */
function Dealer({ round, faded }: { round: BlackjackRound | null; faded: boolean }) {
  const cards = round?.dealer ?? [];
  return (
    <div className={`relative z-10 flex flex-col items-center gap-1 pt-3 transition-opacity @[40rem]:pt-5 ${faded ? "opacity-45" : ""}`}>
      <p className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-gold/80">
        Dealer
        {cards.length > 0 && <TotalPill total={round?.dealerTotal ?? 0} />}
      </p>
      <div className="flex h-[clamp(3.6rem,14cqw,7.7rem)] items-center">
        {cards.length === 0 ? (
          <span className="h-full w-[clamp(2.6rem,10cqw,5.5rem)] rounded-md border border-dashed border-gold/20" />
        ) : (
          cards.map((card, index) => (
            <span key={`${round?.id}-${index}`} className={index > 0 ? "-ml-[clamp(1rem,3.5cqw,2rem)]" : ""}>
              <PlayingCard card={card} size="dealer" />
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Banner({ round, betters, secondsLeft, turnName, myTurn, fading }: { round: BlackjackRound | null; betters: number; secondsLeft: number | null; turnName: string | null; myTurn: boolean; fading: boolean }) {
  const text = !round
    ? "Opening the table…"
    : round.status === "playing"
      ? myTurn
        ? `Your move · ${secondsLeft ?? ""}`
        : `${turnName ?? "Player"} · ${secondsLeft ?? ""}`
      : round.status === "done"
        ? "Dealer plays"
        : round.startsAt
          ? `Cards in ${secondsLeft ?? ""}`
          : betters === 1
            ? "Waiting for a second player"
            : fading
              ? "Place your bets"
              : "Take a seat and bet · two players start a round";
  return (
    <p
      className={`rounded-full border px-3 py-1 text-xs font-semibold tabular-nums @[40rem]:text-sm ${
        myTurn ? "border-gold bg-gold/20 text-gold-bright shadow-[0_0_24px_rgba(233,180,76,0.35)]" : round?.startsAt ? "border-gold/40 bg-black/50 text-gold-bright" : "border-white/10 bg-black/40 text-muted"
      }`}
    >
      {text}
    </p>
  );
}

function Seat({
  number,
  place,
  name,
  pendingBet,
  hands,
  faded,
  you,
  turnHandId,
  secondsLeft,
  canSit,
  onSit,
}: {
  number: number;
  place: { left: number; top: number };
  name: string | null;
  pendingBet: number | null;
  hands: BlackjackHand[];
  faded: boolean;
  you: boolean;
  turnHandId: number | null;
  secondsLeft: number | null;
  canSit: boolean;
  onSit(): void;
}) {
  const active = hands.some((hand) => hand.id === turnHandId);
  return (
    <div
      className="flex min-w-0 flex-col items-center gap-1 @[40rem]:absolute @[40rem]:w-[13%] @[40rem]:-translate-x-1/2 @[40rem]:-translate-y-1/2 @[40rem]:[left:var(--x)] @[40rem]:[top:var(--y)]"
      style={{ "--x": `${place.left}%`, "--y": `${place.top}%` } as React.CSSProperties}
    >
      <div className={`flex min-h-[clamp(3.2rem,11cqw,6rem)] items-end justify-center gap-1 transition-opacity ${faded ? "opacity-45" : ""}`}>
        {hands.map((hand) => (
          <Hand key={hand.id} hand={hand} active={hand.id === turnHandId} secondsLeft={secondsLeft} />
        ))}
      </div>
      {name ? (
        <div
          className={`flex w-full min-w-0 flex-col items-center rounded-xl border px-1 py-1 text-center ${
            active ? "border-gold bg-gold/15 shadow-[0_0_18px_rgba(233,180,76,0.45)]" : you ? "border-gold/50 bg-black/55" : "border-white/10 bg-black/45"
          }`}
        >
          <span className={`max-w-full truncate text-[0.62rem] font-semibold @[40rem]:text-xs ${you ? "text-gold-bright" : "text-text"}`} title={name}>
            {name}
          </span>
          <span className="font-mono text-[0.55rem] text-faint">
            {pendingBet !== null ? <span className="text-gold">bet {formatTokenAmount(BigInt(pendingBet))}</span> : you ? "you" : `seat ${number}`}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSit}
          disabled={!canSit}
          className="grid h-[2.6rem] w-full place-items-center rounded-xl border border-dashed border-gold/25 text-[0.62rem] font-semibold text-gold/70 transition enabled:hover:border-gold/60 enabled:hover:bg-gold/10 enabled:hover:text-gold-bright disabled:text-faint/60 @[40rem]:text-xs"
          aria-label={`Sit at seat ${number}`}
        >
          {canSit ? "+ Sit" : `Seat ${number}`}
        </button>
      )}
    </div>
  );
}

function Hand({ hand, active, secondsLeft }: { hand: BlackjackHand; active: boolean; secondsLeft: number | null }) {
  return (
    <div className="relative flex flex-col items-center">
      <div className="flex items-center gap-1">
        <TotalPill total={hand.total} bust={hand.status === "bust"} blackjack={hand.status === "blackjack"} />
        {active && secondsLeft !== null && <span className="rounded-full bg-gold px-1.5 font-mono text-[0.6rem] font-bold text-ink tabular-nums">{secondsLeft}</span>}
      </div>
      <div className={`mt-0.5 flex rounded-md ${active ? "ring-2 ring-gold ring-offset-2 ring-offset-[#0a1f15]" : ""}`}>
        {hand.cards.map((card, index) => (
          <span key={index} className={index > 0 ? "-ml-[clamp(0.9rem,3.2cqw,1.9rem)]" : ""}>
            <PlayingCard card={card} size="seat" />
          </span>
        ))}
      </div>
      <span className="mt-0.5 rounded-full bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] px-1.5 font-mono text-[0.55rem] font-bold text-[#1a1204] tabular-nums shadow">
        {formatTokenAmount(BigInt(hand.bet))}
        {hand.doubled ? " ×2" : ""}
      </span>
      {hand.result && (
        <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[0.6rem] font-bold uppercase shadow-lg @[40rem]:text-xs ${RESULT_STYLE[hand.result]}`}>
          {RESULT_LABEL[hand.result]}
          {hand.payout > hand.bet ? ` +${formatTokenAmount(BigInt(hand.payout - hand.bet))}` : ""}
        </span>
      )}
    </div>
  );
}

function TotalPill({ total, bust, blackjack }: { total: number; bust?: boolean; blackjack?: boolean }) {
  return (
    <span
      className={`rounded-full px-1.5 font-mono text-[0.6rem] font-bold tabular-nums @[40rem]:text-[0.68rem] ${
        bust ? "bg-danger/90 text-white" : blackjack ? "bg-gold text-ink" : "bg-black/70 text-text"
      }`}
    >
      {blackjack ? "BJ" : total}
    </span>
  );
}

/** A card of the 300 deck with its index (rank and suit) in the corner; null is face down. */
function PlayingCard({ card, size }: { card: Card | null; size: "seat" | "dealer" }) {
  const width = size === "dealer" ? "w-[clamp(2.6rem,10cqw,5.5rem)]" : "w-[clamp(2.1rem,8cqw,4.4rem)]";
  if (card === null) {
    return (
      <span className={`relative block aspect-[5/7] ${width}`}>
        <CardBack className="absolute inset-0 shadow-md shadow-black/60" />
      </span>
    );
  }
  const suit = cardSuit(card);
  const rank = cardRank(card);
  const art = rank === "A" ? aceArt(suit) : cardArt(suit, rank);
  return (
    <motion.span
      className={`relative block aspect-[5/7] overflow-hidden rounded-[12%/9%] bg-[linear-gradient(145deg,#ffe7a8,#e9b44c_42%,#a8691c)] p-[5%] shadow-md shadow-black/60 ${width}`}
      initial={{ y: -24, opacity: 0, rotate: -6 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
    >
      <span className="relative block size-full overflow-hidden rounded-[9%/7%]" style={{ backgroundColor: SUIT_COLORS[suit] }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art.src} alt={`${rank}${SUIT_SYMBOLS[suit]}`} className="absolute inset-0 size-full object-cover" style={{ objectPosition: "50% 30%" }} />
        <span className="absolute left-0 top-0 flex flex-col items-center rounded-br-md bg-black/80 px-[8%] py-[4%] leading-none">
          <span className="text-[clamp(0.55rem,2.1cqw,1.05rem)] font-black text-gold-bright">{rank}</span>
          <span className="text-[clamp(0.5rem,1.8cqw,0.9rem)]" style={{ color: SUIT_COLORS[suit] }}>
            {SUIT_SYMBOLS[suit]}
          </span>
        </span>
      </span>
    </motion.span>
  );
}
