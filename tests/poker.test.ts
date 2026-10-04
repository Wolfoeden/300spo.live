import { describe, expect, it } from "vitest";
import { pokerDeck, rankCategory, rankHand, rankName } from "../lib/game/poker";

// Cards: suit = card / 13 (♠ ♥ ♦ ♣), rank = card % 13 (0 = ace … 12 = king).
const card = (rank: string, suit = 0) => suit * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(rank);
const hand = (...cards: [string, number][]) => cards.map(([rank, suit]) => card(rank, suit));

describe("hand ranking", () => {
  it("finds every category in seven cards", () => {
    expect(rankCategory(rankHand(hand(["A", 0], ["K", 1], ["7", 2], ["5", 3], ["3", 0], ["9", 1], ["J", 2])))).toBe(0);
    expect(rankCategory(rankHand(hand(["A", 0], ["A", 1], ["7", 2], ["5", 3], ["3", 0], ["9", 1], ["J", 2])))).toBe(1);
    expect(rankCategory(rankHand(hand(["A", 0], ["A", 1], ["7", 2], ["7", 3], ["3", 0], ["9", 1], ["J", 2])))).toBe(2);
    expect(rankCategory(rankHand(hand(["A", 0], ["A", 1], ["A", 2], ["7", 3], ["3", 0], ["9", 1], ["J", 2])))).toBe(3);
    expect(rankCategory(rankHand(hand(["4", 0], ["5", 1], ["6", 2], ["7", 3], ["8", 0], ["K", 1], ["K", 2])))).toBe(4);
    expect(rankCategory(rankHand(hand(["2", 1], ["2", 2], ["9", 1], ["J", 1], ["K", 1], ["K", 2], ["K", 3])))).toBe(6);
    // A set and a flush: the flush counts.
    expect(rankCategory(rankHand(hand(["2", 1], ["5", 1], ["9", 1], ["J", 1], ["K", 1], ["K", 2], ["K", 3])))).toBe(5);
    expect(rankCategory(rankHand(hand(["2", 1], ["5", 1], ["9", 1], ["J", 1], ["K", 1], ["K", 2], ["Q", 3])))).toBe(5);
    expect(rankCategory(rankHand(hand(["9", 0], ["9", 1], ["9", 2], ["9", 3], ["K", 1], ["K", 2], ["K", 3])))).toBe(7);
    expect(rankCategory(rankHand(hand(["5", 2], ["6", 2], ["7", 2], ["8", 2], ["9", 2], ["10", 2], ["A", 0])))).toBe(8);
  });

  it("counts the ace low in the wheel and high in broadway", () => {
    expect(rankName(rankHand(hand(["A", 0], ["2", 1], ["3", 2], ["4", 3], ["5", 0], ["K", 1], ["Q", 2])))).toBe("Straight to the 5");
    expect(rankName(rankHand(hand(["A", 0], ["K", 1], ["Q", 2], ["J", 3], ["10", 0], ["2", 1], ["2", 2])))).toBe("Straight to the ace");
    expect(rankName(rankHand(hand(["A", 3], ["K", 3], ["Q", 3], ["J", 3], ["10", 3], ["2", 1], ["2", 2])))).toBe("Royal flush");
  });

  it("breaks ties on kickers and splits equal hands", () => {
    const board = hand(["K", 0], ["K", 1], ["7", 2], ["4", 3], ["2", 0]);
    const ace = rankHand([...board, ...hand(["A", 2], ["3", 3])]);
    const queen = rankHand([...board, ...hand(["Q", 2], ["J", 3])]);
    expect(ace).toBeGreaterThan(queen);
    // The board plays for both: a split pot.
    const royal = hand(["A", 0], ["K", 0], ["Q", 0], ["J", 0], ["10", 0]);
    expect(rankHand([...royal, ...hand(["2", 1], ["3", 1])])).toBe(rankHand([...royal, ...hand(["9", 2], ["9", 3])]));
    // Two pair: the best two of three pairs, and the best kicker.
    expect(rankName(rankHand(hand(["9", 0], ["9", 1], ["7", 2], ["7", 3], ["5", 0], ["5", 1], ["2", 2])))).toBe("Two pair, nines and sevens");
  });

  it("names hands", () => {
    expect(rankName(rankHand(hand(["Q", 0], ["Q", 1], ["Q", 2], ["5", 3], ["5", 0], ["9", 1], ["J", 2])))).toBe("Full house, queens over fives");
    expect(rankName(rankHand(hand(["K", 0], ["K", 1], ["7", 2], ["5", 3], ["3", 0], ["9", 1], ["J", 2])))).toBe("Pair of kings");
    expect(rankName(rankHand(hand(["2", 1], ["5", 1], ["9", 1], ["J", 1], ["K", 1], ["K", 2], ["Q", 3])))).toBe("Flush, king high");
  });
});

describe("the deck", () => {
  it("is the same shuffle as game.pk_deck() in the database", async () => {
    // Computed in the database on 4 October 2026 (seed: 32 bytes of 0xab, client seed "test").
    const seed = "ab".repeat(32);
    expect((await pokerDeck(seed, "test", 1)).slice(0, 10)).toEqual([44, 29, 13, 12, 33, 22, 27, 28, 23, 4]);
    expect((await pokerDeck(seed, "test", 2)).slice(0, 10)).toEqual([25, 42, 43, 35, 4, 34, 20, 7, 47, 32]);
    const deck = await pokerDeck(seed, "test", 3);
    expect([...deck].sort((a, b) => a - b)).toEqual(Array.from({ length: 52 }, (_, index) => index));
  });
});
