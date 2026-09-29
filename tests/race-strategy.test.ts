import { describe, expect, it } from "vitest";
import { layoutStakes, strategyPick } from "../lib/game/race-strategy";

// Odds in basis points, as the server deals them (10000 = 1×).
const deal = [25200, 22100, 243400, 90800];

describe("strategyPick", () => {
  it("takes the colour's ace while it can win", () => {
    expect(strategyPick("blue", deal)).toBe(0);
    expect(strategyPick("red", deal)).toBe(1);
    expect(strategyPick("yellow", deal)).toBe(2);
    expect(strategyPick("green", deal)).toBe(3);
    expect(strategyPick("blue", [0, 22100, 243400, 90800])).toBeNull();
  });

  it("takes the lowest and the highest odds", () => {
    expect(strategyPick("low", deal)).toBe(1);
    expect(strategyPick("high", deal)).toBe(2);
  });

  it("takes middle odds between favourite and outsider", () => {
    // 2.21×, 2.52×, 9.08×, 24.34×: 9.08× sits nearest the middle of 2.21× and 24.34×.
    expect(strategyPick("mid", deal)).toBe(3);
    expect(strategyPick("mid", [190427, 484730, 16957, 29659])).toBe(0);
  });

  it("skips aces that cannot win", () => {
    expect(strategyPick("high", [0, 30000, 1000000, 0])).toBe(2);
    expect(strategyPick("low", [0, 30000, 1000000, 0])).toBe(1);
    expect(strategyPick("mid", [0, 30000, 1000000, 80000])).toBe(3);
    expect(strategyPick("high", [0, 0, 0, 0])).toBeNull();
    expect(strategyPick("low", null)).toBeNull();
  });
});

describe("layoutStakes", () => {
  const deals = [deal, [0, 30000, 1000000, 80000]];

  it("stacks chips per lane up to the max bet", () => {
    const stakes = layoutStakes(
      [
        { kind: "lane", board: 0, suit: 1, amount: 600 },
        { kind: "lane", board: 0, suit: 1, amount: 3000 },
        { kind: "lane", board: 1, suit: 3, amount: 300 },
      ],
      deals,
      3000,
    );
    expect(stakes).toEqual([
      [0, 3000, 0, 0],
      [0, 0, 0, 300],
    ]);
  });

  it("puts a strategy's chip on every race and skips lanes that cannot win", () => {
    const stakes = layoutStakes(
      [
        { kind: "rule", strategy: "blue", amount: 300 },
        { kind: "rule", strategy: "high", amount: 600 },
        { kind: "lane", board: 1, suit: 0, amount: 300 },
      ],
      deals,
      3000,
    );
    expect(stakes).toEqual([
      [300, 0, 600, 0],
      [0, 0, 600, 0],
    ]);
  });
});
