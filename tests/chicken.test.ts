import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CELLS, DIFFICULTIES, chickenLanes, chickenMultiplierBps, crashLane, hitChance } from "../lib/game/chicken";

// Computed by game.chicken_* in Postgres (server seed 000102, client seed "client").
const DB_CRASH = [
  { nonce: 1, h1: 2, h3: 2, h5: 2, h10: 2 },
  { nonce: 2, h1: 2, h3: 2, h5: 2, h10: 1 },
  { nonce: 3, h1: 21, h3: 7, h5: 7, h10: 1 },
  { nonce: 4, h1: 5, h3: 3, h5: 3, h10: 1 },
  { nonce: 5, h1: 24, h3: 3, h5: 3, h10: 3 },
  { nonce: 6, h1: 13, h3: 7, h5: 7, h10: 2 },
];
const DB_MULTIPLIER_CHECKSUM = "7ecafc2703de84a0224114dee25f52de";

describe("chicken", () => {
  it("has the database's lanes and multipliers", () => {
    expect(DIFFICULTIES.map(({ hazards }) => chickenLanes(hazards))).toEqual([24, 22, 20, 13]);
    expect(chickenMultiplierBps(1, 1)).toBe(10416n);
    expect(chickenMultiplierBps(1, 24)).toBe(250000n);
    expect(chickenMultiplierBps(10, 13)).toBe(495266666n);
    const lines = DIFFICULTIES.flatMap(({ hazards }) =>
      Array.from({ length: chickenLanes(hazards) }, (_, index) => `${hazards}:${index + 1}:${chickenMultiplierBps(hazards, index + 1)}`),
    );
    expect(createHash("md5").update(lines.join(",")).digest("hex")).toBe(DB_MULTIPLIER_CHECKSUM);
  });

  it("puts the car where the database does", async () => {
    for (const row of DB_CRASH) {
      expect(await crashLane("000102", "client", row.nonce, 1)).toBe(row.h1);
      expect(await crashLane("000102", "client", row.nonce, 3)).toBe(row.h3);
      expect(await crashLane("000102", "client", row.nonce, 5)).toBe(row.h5);
      expect(await crashLane("000102", "client", row.nonce, 10)).toBe(row.h10);
    }
  });

  it("never pays more than the fair price at any lane", () => {
    for (const { hazards } of DIFFICULTIES) {
      let survive = 1;
      for (let step = 1; step <= chickenLanes(hazards); step += 1) {
        survive *= 1 - hitChance(hazards, step - 1);
        expect((survive * Number(chickenMultiplierBps(hazards, step))) / 10000).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("places the first car uniformly like the mines maths says", async () => {
    // With one car the first car is equally likely on any of the 25 cells.
    const counts = new Array(CELLS + 1).fill(0);
    const runs = 2500;
    for (let nonce = 1; nonce <= runs; nonce += 1) counts[await crashLane("abcdef", "seed", nonce, 1)] += 1;
    for (let lane = 1; lane <= CELLS; lane += 1) expect(Math.abs(counts[lane] / runs - 1 / CELLS)).toBeLessThan(0.02);
  });
});
