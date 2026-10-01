// Blackjack at a shared table: the public state the server pushes, card
// helpers that match game.bj_total() in the database, and the shuffle a player
// can recompute once a round's server seed is revealed.
import { hmacShuffle } from "./fair";

export const SEATS = 7;

/** A card as the table shows it: 0..51, suit card / 13 (♠ ♥ ♦ ♣), rank card % 13 (0 = ace … 12 = king). */
export type Card = number;

export type BlackjackHand = {
  id: number;
  seat: number;
  /** 1 is the second hand after a split. */
  part: number;
  name: string;
  bet: number;
  cards: Card[];
  total: number;
  status: "playing" | "stood" | "bust" | "blackjack";
  doubled: boolean;
  split: boolean;
  result: "win" | "blackjack" | "push" | "lose" | null;
  payout: number;
};

export type BlackjackRound = {
  id: number;
  status: "betting" | "playing" | "done";
  startsAt: string | null;
  turnHand: number | null;
  turnDeadline: string | null;
  serverSeedHash: string;
  serverSeed: string | null;
  clientSeed: string | null;
  /** The dealer's cards; while players decide, the hole card is null. */
  dealer: (Card | null)[];
  dealerTotal: number;
  hands: BlackjackHand[];
  finishedAt: string | null;
};

export type BlackjackView = {
  table: number;
  now: string;
  bets: { min: number; max: number; step: number };
  seats: { seat: number; name: string; bet: number | null }[];
  tables: { id: number; seated: number }[];
  round: BlackjackRound | null;
  /** The round before, while the next one takes bets. */
  last: BlackjackRound | null;
};

/** What the server answers a player: the view plus their own place at it. */
export type BlackjackState = BlackjackView & {
  you: { seat: number | null; table: number | null; hands: number[]; balance: number };
};

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const cardRank = (card: Card) => RANKS[card % 13];
export const cardSuit = (card: Card) => Math.floor(card / 13) % 4;
export const cardValue = (card: Card) => (card % 13 === 0 ? 11 : Math.min((card % 13) + 1, 10));

/** The best total: aces count 11 unless that busts the hand. `soft` while an ace still counts 11. */
export function handTotal(cards: readonly (Card | null)[]) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card === null) continue;
    total += cardValue(card);
    if (card % 13 === 0) aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 && total <= 21 };
}

/** Two cards worth the same split into two hands (once). */
export const canSplit = (hand: Pick<BlackjackHand, "cards" | "split">) =>
  hand.cards.length === 2 && !hand.split && cardValue(hand.cards[0]) === cardValue(hand.cards[1]);

/** The six-deck shoe of a round (cards 0..311; card % 52 is the card). */
export const blackjackShoe = (serverSeedHex: string, clientSeed: string, roundId: number) => hmacShuffle(serverSeedHex, clientSeed, roundId, "blackjack", 312);

/** The name a wallet without an ADA Handle has at the table: the last five characters of its address. */
export const shortName = (wallet: string) => `…${wallet.slice(-5)}`;
