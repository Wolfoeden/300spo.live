// Chicken: the blue cock crosses the lanes of a road. Mirrors game.chicken_* in
// the database: "mines" on 25 cells with h cars, the walk visits the cells in
// a shuffled order and ends on the lane of the first car.
import { hmacShuffle } from "./fair";

export const CELLS = 25;
/** Lanes stop before the multiplier passes this (in basis points: 100,000×). */
export const MAX_MULTIPLIER_BPS = 1_000_000_000n;

export const DIFFICULTIES = [
  { hazards: 1, label: "Easy" },
  { hazards: 3, label: "Medium" },
  { hazards: 5, label: "Hard" },
  { hazards: 10, label: "Hardcore" },
] as const;

export const difficultyLabel = (hazards: number) => DIFFICULTIES.find((entry) => entry.hazards === hazards)?.label ?? `${hazards} cars`;

/** Fair multiplier after `step` safe lanes: C(25, k) / C(25-h, k), rounded down to a basis point. */
export const chickenMultiplierBps = (hazards: number, step: number) => {
  let numerator = 1n;
  let denominator = 1n;
  for (let index = 0; index < step; index += 1) {
    numerator *= BigInt(CELLS - index);
    denominator *= BigInt(CELLS - hazards - index);
  }
  return (numerator * 10000n) / denominator;
};

export const chickenLanes = (hazards: number) => {
  let lanes = 0;
  for (let step = 1; step <= CELLS - hazards; step += 1) if (chickenMultiplierBps(hazards, step) <= MAX_MULTIPLIER_BPS) lanes = step;
  return lanes;
};

/** Chance that the next lane has the car, after `step` safe lanes. */
export const hitChance = (hazards: number, step: number) => hazards / (CELLS - step);

/** Lane (1-based) of the first car in the shuffled walk; beyond the last lane means the cock gets across. */
export const crashLane = async (serverSeedHex: string, clientSeed: string, nonce: number, hazards: number) => {
  const cells = await hmacShuffle(serverSeedHex, clientSeed, nonce, "chicken", CELLS);
  return cells.findIndex((cell) => cell < hazards) + 1;
};
