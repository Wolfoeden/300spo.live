import { describe, expect, it } from "vitest";
import { blackjackShoe, canSplit, cardRank, cardSuit, handTotal, shortName } from "../lib/game/blackjack";

// Cards: suit = card / 13 (♠ ♥ ♦ ♣), rank = card % 13 (0 = ace … 12 = king).
const card = (rank: number, suit = 0) => suit * 13 + rank;
const ACE = card(0);
const KING = card(12);

describe("hand totals", () => {
  it("counts an ace as 11 unless the hand would bust", () => {
    expect(handTotal([ACE, KING])).toEqual({ total: 21, soft: true });
    expect(handTotal([ACE, ACE])).toEqual({ total: 12, soft: true });
    expect(handTotal([ACE, ACE, card(8)])).toEqual({ total: 21, soft: true });
    expect(handTotal([card(9), card(5), ACE])).toEqual({ total: 17, soft: false });
    expect(handTotal([KING, card(5), card(8)])).toEqual({ total: 25, soft: false });
  });

  it("leaves out the hidden hole card", () => {
    expect(handTotal([card(7), null]).total).toBe(8);
  });
});

describe("cards", () => {
  it("names rank and suit", () => {
    expect(cardRank(49)).toBe("J");
    expect(cardSuit(49)).toBe(3);
    expect(cardRank(card(9, 2))).toBe("10");
  });

  it("splits two cards of the same value once", () => {
    expect(canSplit({ cards: [card(11, 2), card(12, 2)], split: false })).toBe(true);
    expect(canSplit({ cards: [card(11, 2), card(12, 2)], split: true })).toBe(false);
    expect(canSplit({ cards: [card(4), card(5)], split: false })).toBe(false);
  });
});

describe("the shoe", () => {
  it("is the same shuffle as game.bj_shoe() in the database", async () => {
    // Round 1, played in the database on 1 October 2026 and revealed.
    const shoe = await blackjackShoe("234d7aa2d3e81b5ae5c8831787f2fce0b68044cbdeefa525445649ee88c1e047", "bba1a75e6b5b80a2|33962bb907306918", 1);
    expect(shoe).toHaveLength(312);
    expect(shoe.slice(0, 12)).toEqual([309, 245, 189, 285, 90, 25, 136, 59, 132, 266, 112, 210]);
    expect(new Set(shoe).size).toBe(312);
  });
});

describe("names", () => {
  it("shows the last five characters of an address", () => {
    expect(shortName("stake1uymr7dv8rf7frr7jk28u7pn8rdjlcjpfhzw2wmckkfd8pwstzp674")).toBe("…zp674");
  });
});
