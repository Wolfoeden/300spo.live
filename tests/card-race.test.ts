import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { aceArt, cardArt } from "../lib/game/card-art";
import {
  DECK_SIZE,
  FINISH,
  allPatterns,
  cardRank,
  cardSuit,
  oddsBps,
  patternOdds,
  positionsAfter,
  raceDeck,
  runRace,
  trackOdds,
  trackPattern,
  winProbabilities,
} from "../lib/game/card-race";

// Computed by game.race_deck / game.race_run / game.race_odds_for in Postgres
// for server seed 000102, client seed "client", nonce 1.
const DB_DECK = [
  28, 19, 8, 23, 9, 44, 20, 18, 3, 2, 4, 1, 41, 42, 11, 17, 43, 5, 26, 12, 33, 38, 34, 31, 29, 7, 14, 6, 15, 0, 37, 45, 22, 47, 36, 32, 30, 21,
  40, 24, 10, 27, 25, 13, 16, 35, 39, 46,
];
// md5 of "pattern:o0,o1,o2,o3" lines of game.race_odds, ordered by pattern.
const DB_ODDS_CHECKSUM = "31178ac0f1709ae30fba9a4b89cd1cfc";

const shuffled = () => {
  const deck = Array.from({ length: DECK_SIZE }, (_, card) => card);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

describe("card race deck", () => {
  it("shuffles exactly like the database", async () => {
    const deck = await raceDeck("000102", "client", 1);
    expect(deck).toEqual(DB_DECK);
    expect([...deck].sort((a, b) => a - b)).toEqual(Array.from({ length: DECK_SIZE }, (_, card) => card));
  });

  it("runs the database's reference race", () => {
    expect(runRace(DB_DECK)).toMatchObject({ winner: 0, draws: 23 });
    expect(trackOdds(DB_DECK.slice(0, 7))).toEqual([83339, 1000000, 35055, 17063]);
  });

  it("ends every race with one ace on the finish step", () => {
    for (let run = 0; run < 2000; run += 1) {
      const race = runRace(shuffled());
      const positions = positionsAfter(race.events, race.events.length);
      expect(positions[race.winner]).toBe(FINISH);
      expect(Math.max(...positions.filter((_, suit) => suit !== race.winner))).toBeLessThan(FINISH);
      expect(Math.min(...positions)).toBeGreaterThanOrEqual(0);
    }
  });

  it("sends the ace of a track card back once every ace has reached it", () => {
    // Track: seven hearts. Draw ♠ ♥ ♦ ♣ → all aces reach step 1 → hearts steps back.
    const hearts = [12, 13, 14, 15, 16, 17, 18];
    const rest = [0, 19, 24, 36, ...Array.from({ length: DECK_SIZE }, (_, card) => card).filter((card) => ![...hearts, 0, 19, 24, 36].includes(card))];
    const race = runRace([...hearts, ...rest]);
    expect(race.events.slice(0, 5)).toEqual([
      { kind: "draw", card: 0, suit: 0 },
      { kind: "draw", card: 19, suit: 1 },
      { kind: "draw", card: 24, suit: 2 },
      { kind: "draw", card: 36, suit: 3 },
      { kind: "setback", row: 1, suit: 1 },
    ]);
  });
});

describe("card art", () => {
  it("gives every card its own 300 DEGEN image that ships with the site", () => {
    const sources = [
      ...Array.from({ length: DECK_SIZE }, (_, card) => cardArt(cardSuit(card), cardRank(card)).src),
      ...[0, 1, 2, 3].map((suit) => aceArt(suit).src),
    ];
    expect(new Set(sources).size).toBe(DECK_SIZE + 4);
    for (const src of sources) expect(existsSync(join(process.cwd(), "public", src))).toBe(true);
    expect(cardArt(0, "K")).toMatchObject({ alt: "DEGEN #001 Leonidas", face: true });
  });
});

describe("card race odds", () => {
  it("has one entry per track pattern and matches the database table", () => {
    const patterns = allPatterns();
    expect(patterns).toHaveLength(715);
    const lines = [...patterns].sort().map((pattern) => `${pattern}:${patternOdds(pattern).join(",")}`);
    expect(createHash("md5").update(lines.join("\n")).digest("hex")).toBe(DB_ODDS_CHECKSUM);
  });

  it("relabels suits by first appearance", () => {
    expect(trackPattern([2, 2, 0, 3, 2, 0, 0])).toEqual({ pattern: "0012011", labelOf: [1, 3, 0, 2] });
  });

  it("gives probabilities that sum to one and agree with simulation", () => {
    const trackSuits = [1, 1, 0, 2, 3, 1, 0];
    const probabilities = winProbabilities(trackSuits);
    expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);

    const track = trackSuits.map((suit, index) => suit * 12 + index);
    const rest = Array.from({ length: DECK_SIZE }, (_, card) => card).filter((card) => !track.includes(card));
    const wins = [0, 0, 0, 0];
    const runs = 40_000;
    for (let run = 0; run < runs; run += 1) {
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      wins[runRace([...track, ...rest]).winner] += 1;
    }
    // 40k runs: standard error ≤ 0.0025, so 0.012 is ~5 sigma.
    wins.forEach((count, suit) => expect(Math.abs(count / runs - probabilities[suit])).toBeLessThan(0.012));
  });

  it("never pays more than the fair price", () => {
    for (const pattern of allPatterns()) {
      const probabilities = winProbabilities([...pattern].map(Number));
      probabilities.forEach((probability) => expect((probability * oddsBps(probability)) / 10000).toBeLessThanOrEqual(1 + 1e-9));
    }
  });

  it("marks aces that cannot win", () => {
    // Seven spades: only five spades are left, not enough for eight steps.
    expect(patternOdds("0000000")).toEqual([0, 30000, 30000, 30000]);
    expect(cardSuit(47)).toBe(3);
  });
});
