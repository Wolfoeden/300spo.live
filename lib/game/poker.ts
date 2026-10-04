// Texas Hold'em at a shared table: the public state the server pushes, the
// hand ranking (the same score as game.pk_rank() in the database) and the deck
// a player can recompute once a hand's server seed is revealed.
import type { Card } from "./blackjack";
import { hmacShuffle } from "./fair";

export const POKER_SEATS = 6;

export type PokerPlayer = {
  seat: number;
  name: string;
  /** Put in during this betting round, and during the whole hand. */
  bet: number;
  total: number;
  status: "active" | "folded" | "allin";
  /** What the player did last: small blind, big blind, check, call, bet, raise, allin, fold. */
  action: string | null;
  won: number;
  /** Only at the showdown, for the hands still in it. */
  cards: Card[] | null;
  rank: number | null;
};

export type PokerHand = {
  id: number;
  status: "waiting" | "playing" | "done";
  startsAt: string | null;
  street: "preflop" | "flop" | "turn" | "river" | "showdown";
  button: number | null;
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  turnSeat: number | null;
  turnDeadline: string | null;
  currentBet: number;
  minRaise: number;
  pot: number;
  board: Card[];
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string | null;
  finishedAt: string | null;
  players: PokerPlayer[];
};

export type PokerView = {
  table: number;
  now: string;
  blinds: { small: number; big: number };
  buyIn: { min: number; max: number };
  /** `highRoller`: more than 1,000,000 game credit with the stack (the balance itself is never sent). */
  seats: { seat: number; name: string; stack: number; sittingOut: boolean; highRoller?: boolean }[];
  hand: PokerHand | null;
  /** The hand before, while the next one waits. */
  last: PokerHand | null;
};

/** What the server answers a player: the view, their seat and their own cards, and the topic of the table's pushes. */
export type PokerState = PokerView & {
  you: { seat: number | null; table: number | null; topic: string; hand: { id: number; seat: number; cards: Card[] } | null; balance: number };
};

/** A card's worth in poker: 2 … 14, the ace high. */
export const pokerValue = (card: Card) => (card % 13 === 0 ? 14 : (card % 13) + 1);

/** The top card of the highest straight (an ace also counts as one), or 0. */
const straightHigh = (values: readonly number[]) => {
  const present = new Set(values);
  if (present.has(14)) present.add(1);
  for (let high = 14; high >= 5; high -= 1) {
    let run = true;
    for (let value = high - 4; value <= high; value += 1) run &&= present.has(value);
    if (run) return high;
  }
  return 0;
};

/** The category times 16^5, plus up to five deciding values, 4 bits each. */
const score = (category: number, values: readonly number[]) =>
  category * 1_048_576 + values.slice(0, 5).reduce((sum, value, index) => sum + value * 16 ** (4 - index), 0);

/**
 * The best five of five to seven cards as a score: the higher hand wins, equal
 * scores split the pot. Categories: 0 high card, 1 pair, 2 two pair, 3 three of
 * a kind, 4 straight, 5 flush, 6 full house, 7 four of a kind, 8 straight flush.
 */
export function rankHand(cards: readonly Card[]) {
  let flush: number[] | null = null;
  for (let suit = 0; suit < 4 && !flush; suit += 1) {
    const values = cards.filter((card) => Math.floor(card / 13) === suit).map(pokerValue);
    if (values.length >= 5) flush = values.sort((a, b) => b - a);
  }
  if (flush) {
    const high = straightHigh(flush);
    if (high) return score(8, [high]);
  }
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(pokerValue(card), (counts.get(pokerValue(card)) ?? 0) + 1);
  // The most frequent values first, then the highest.
  const groups = [...counts].sort(([valueA, countA], [valueB, countB]) => countB - countA || valueB - valueA);
  const [first, second] = groups;
  const distinct = [...counts.keys()].sort((a, b) => b - a);
  const others = (...skip: number[]) => distinct.filter((value) => !skip.includes(value));
  if (first[1] === 4) return score(7, [first[0], others(first[0])[0]]);
  if (first[1] === 3 && (second?.[1] ?? 0) >= 2) return score(6, [first[0], second[0]]);
  if (flush) return score(5, flush);
  const high = straightHigh(distinct);
  if (high) return score(4, [high]);
  if (first[1] === 3) return score(3, [first[0], ...others(first[0]).slice(0, 2)]);
  if (first[1] === 2 && second?.[1] === 2) return score(2, [first[0], second[0], others(first[0], second[0])[0]]);
  if (first[1] === 2) return score(1, [first[0], ...others(first[0]).slice(0, 3)]);
  return score(0, distinct);
}

export const rankCategory = (rank: number) => Math.floor(rank / 1_048_576);

const CATEGORIES = ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"];
const PLURAL = ["", "", "twos", "threes", "fours", "fives", "sixes", "sevens", "eights", "nines", "tens", "jacks", "queens", "kings", "aces"];
const SINGLE = ["", "", "2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace"];

/** A hand in words: "Pair of kings", "Full house, queens over fives". */
export function rankName(rank: number) {
  const category = rankCategory(rank);
  const value = (index: number) => Math.floor(rank / 16 ** (4 - index)) % 16;
  switch (category) {
    case 0:
      return `High card ${SINGLE[value(0)]}`;
    case 1:
      return `Pair of ${PLURAL[value(0)]}`;
    case 2:
      return `Two pair, ${PLURAL[value(0)]} and ${PLURAL[value(1)]}`;
    case 3:
      return `Three ${PLURAL[value(0)]}`;
    case 4:
      return `Straight to the ${SINGLE[value(0)]}`;
    case 5:
      return `Flush, ${SINGLE[value(0)]} high`;
    case 6:
      return `Full house, ${PLURAL[value(0)]} over ${PLURAL[value(1)]}`;
    case 7:
      return `Four ${PLURAL[value(0)]}`;
    case 8:
      return value(0) === 14 ? "Royal flush" : `Straight flush to the ${SINGLE[value(0)]}`;
    default:
      return CATEGORIES[category] ?? "";
  }
}

export const categoryName = (category: number) => CATEGORIES[category] ?? "";

/** The deck of a hand (cards 0..51), as game.pk_deck() shuffles it. */
export const pokerDeck = (serverSeedHex: string, clientSeed: string, handId: number) => hmacShuffle(serverSeedHex, clientSeed, handId, "poker", 52);
