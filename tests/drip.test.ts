import { describe, expect, it } from "vitest";
import { allocate, eligibleWallets, formatUnits, parseUnits, tierCounts, tierOf, type Delegator, type Holder, type Reward } from "../lib/drip/allocate";

const ADA = 1_000_000n;
const rules = { minTokens: 3_000_000n, tier1: 10_000n * ADA, tier2: 100_000n * ADA };

const holders: Holder[] = [
  { payment_address: "addr1qa1", stake_address: "stake1a", quantity: "2000000" },
  { payment_address: "addr1qa2", stake_address: "stake1a", quantity: "1500000" }, // together 3.5M
  { payment_address: "addr1qb1", stake_address: "stake1b", quantity: "9000000" },
  { payment_address: "addr1qc1", stake_address: "stake1c", quantity: "2999999" }, // just below
  { payment_address: "addr1qd1", stake_address: "stake1d", quantity: "50000000" }, // holds, does not delegate
  { payment_address: "addr1ve1", stake_address: null, quantity: "80000000" }, // enterprise address
  { payment_address: "addr1zf1", stake_address: "stake1f", quantity: "90000000" }, // script address (DEX pool)
  { payment_address: "addr1qt1", stake_address: "stake1treasury", quantity: "70000000" }, // excluded
];
const delegators: Delegator[] = [
  { stake_address: "stake1a", amount: String(12_000n * ADA) }, // tier 1
  { stake_address: "stake1b", amount: String(150_000n * ADA) }, // tier 2
  { stake_address: "stake1c", amount: String(500_000n * ADA) }, // delegates a lot but holds too little
  { stake_address: "stake1e", amount: String(20_000n * ADA) }, // delegates, holds nothing
];
const wallets = eligibleWallets(holders, delegators, { ...rules, excluded: ["stake1treasury"] });

describe("eligibleWallets", () => {
  it("counts holders with enough 300 per stake key, delegated or not", () => {
    expect(wallets.map((wallet) => wallet.stake)).toEqual(["stake1a", "stake1b", "stake1d"]);
    expect(wallets[0]).toEqual({ stake: "stake1a", address: "addr1qa1", tokens: 3_500_000n, delegated: 12_000n * ADA, tier: 1 });
  });

  it("puts each holder in the tier its delegation reaches", () => {
    expect(wallets.map((wallet) => wallet.tier)).toEqual([1, 2, 0]);
    expect(tierCounts(wallets)).toEqual({ holders: 3, tier1: 2, tier2: 1 });
  });

  it("leaves out script and enterprise addresses and excluded wallets", () => {
    const stakes = wallets.map((wallet) => wallet.stake);
    expect(stakes).not.toContain("stake1f");
    expect(stakes).not.toContain("stake1treasury");
  });

  it("uses the thresholds inclusively", () => {
    expect(tierOf(10_000n * ADA - 1n, rules)).toBe(0);
    expect(tierOf(10_000n * ADA, rules)).toBe(1);
    expect(tierOf(100_000n * ADA, rules)).toBe(2);
  });
});

describe("allocate", () => {
  const line = (unit: string, perEpoch: bigint, tier: Reward["tier"], distribution: Reward["distribution"] = "equal"): Reward => ({
    unit,
    perEpoch,
    tier,
    distribution,
  });
  const amounts = (allocations: ReturnType<typeof allocate>, unit: string) =>
    Object.fromEntries(allocations.filter((allocation) => allocation.unit === unit).map((allocation) => [allocation.stake, allocation.amount]));

  it("gives a tier's line to that tier and every tier above it", () => {
    const allocations = allocate(wallets, [line("300", 3_000n, 0), line("lovelace", 10_000_001n, 1), line("night", 500n, 2)]);
    expect(amounts(allocations, "300")).toEqual({ stake1a: 1_000n, stake1b: 1_000n, stake1d: 1_000n });
    expect(amounts(allocations, "lovelace")).toEqual({ stake1a: 5_000_000n, stake1b: 5_000_000n });
    expect(amounts(allocations, "night")).toEqual({ stake1b: 500n });
  });

  it("adds a higher tier's line of the same unit on top", () => {
    const allocations = allocate(wallets, [line("lovelace", 1_000n, 1), line("lovelace", 600n, 2)]);
    expect(amounts(allocations, "lovelace")).toEqual({ stake1a: 500n, stake1b: 1_100n });
    expect(allocations.find((allocation) => allocation.stake === "stake1b")?.tier).toBe(2);
  });

  it("weights by 300 held or by ADA delegated", () => {
    expect(amounts(allocate(wallets, [line("meme", 62_500n, 0, "tokens")]), "meme")).toEqual({ stake1a: 3_500n, stake1b: 9_000n, stake1d: 50_000n });
    expect(amounts(allocate(wallets, [line("night", 162_000n, 1, "stake")]), "night")).toEqual({ stake1a: 12_000n, stake1b: 150_000n });
  });

  it("never exceeds a budget and skips empty lines", () => {
    const allocations = allocate(wallets, [line("300", 100n, 0), line("unused", 0n, 0)]);
    expect(allocations.reduce((sum, allocation) => sum + allocation.amount, 0n)).toBeLessThanOrEqual(100n);
    expect(allocations.some((allocation) => allocation.unit === "unused")).toBe(false);
    expect(allocate([], [line("300", 100n, 0)])).toEqual([]);
  });

  it("allocates nothing to a tier nobody reaches", () => {
    const small = eligibleWallets(holders, [], rules);
    expect(allocate(small, [line("lovelace", 1_000n, 1)])).toEqual([]);
  });
});

describe("units", () => {
  it("formats and parses decimal amounts exactly", () => {
    expect(formatUnits(1_500_000n, 6)).toBe("1.5");
    expect(formatUnits(12_345_000_000n, 6)).toBe("12,345");
    expect(parseUnits("1.5", 6)).toBe(1_500_000n);
    expect(parseUnits("1,000", 0)).toBe(1000n);
    expect(parseUnits("0.0000001", 6)).toBeNull();
    expect(parseUnits("abc", 6)).toBeNull();
  });
});
