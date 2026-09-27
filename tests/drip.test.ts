import { describe, expect, it } from "vitest";
import { allocate, eligibleWallets, formatUnits, parseUnits, type Delegator, type Holder } from "../lib/drip/allocate";

const holders: Holder[] = [
  { payment_address: "addr1qa1", stake_address: "stake1a", quantity: "2000000" },
  { payment_address: "addr1qa2", stake_address: "stake1a", quantity: "1500000" }, // together 3.5M
  { payment_address: "addr1qb1", stake_address: "stake1b", quantity: "9000000" },
  { payment_address: "addr1qc1", stake_address: "stake1c", quantity: "2999999" }, // just below
  { payment_address: "addr1qd1", stake_address: "stake1d", quantity: "50000000" }, // not delegated
  { payment_address: "addr1ve1", stake_address: null, quantity: "80000000" }, // enterprise address
];
const delegators: Delegator[] = [
  { stake_address: "stake1a", amount: "1000000000" },
  { stake_address: "stake1b", amount: "3000000000" },
  { stake_address: "stake1c", amount: "5000000000" },
];

describe("eligibleWallets", () => {
  it("sums holdings per stake key and requires delegation plus the minimum", () => {
    const wallets = eligibleWallets(holders, delegators, 3_000_000n);
    expect(wallets.map((wallet) => wallet.stake)).toEqual(["stake1a", "stake1b"]);
    expect(wallets[0]).toEqual({ stake: "stake1a", address: "addr1qa1", tokens: 3_500_000n, delegated: 1_000_000_000n });
  });
});

describe("allocate", () => {
  const wallets = eligibleWallets(holders, delegators, 3_000_000n);
  const rewards = [
    { unit: "lovelace", perEpoch: 10_000_001n },
    { unit: "night", perEpoch: 1_000n },
    { unit: "unused", perEpoch: 0n },
  ];

  it("splits equally and never exceeds the budget", () => {
    const allocations = allocate(wallets, rewards, "equal");
    expect(allocations.filter((a) => a.unit === "lovelace").map((a) => a.amount)).toEqual([5_000_000n, 5_000_000n]);
    expect(allocations.some((a) => a.unit === "unused")).toBe(false);
  });

  it("weights by 300 holdings or by delegated stake", () => {
    const byTokens = allocate(wallets, [{ unit: "night", perEpoch: 12_500n }], "tokens");
    expect(byTokens.map((a) => a.amount)).toEqual([3_500n, 9_000n]);
    const byStake = allocate(wallets, [{ unit: "night", perEpoch: 4_000n }], "stake");
    expect(byStake.map((a) => a.amount)).toEqual([1_000n, 3_000n]);
  });

  it("allocates nothing without eligible wallets", () => {
    expect(allocate([], rewards, "equal")).toEqual([]);
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
