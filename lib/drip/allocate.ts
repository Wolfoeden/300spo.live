// Drip eligibility and shares. Pure functions over Koios `asset_addresses`
// (holders of the 300 token) and `pool_delegators` (wallets staked with 300).
//
// Tier 0 holds at least `minTokens` 300; tiers 1 and 2 hold that much and
// also delegate at least `tier1` / `tier2` lovelace to the pool. A reward line
// goes to every wallet at or above its tier, so higher tiers collect the
// lines of the tiers below as well.

export type Holder = { payment_address: string; stake_address: string | null; quantity: string };
export type Delegator = { stake_address: string; amount: string };
export type Distribution = "equal" | "tokens" | "stake";
export type Tier = 0 | 1 | 2;
export type Reward = { unit: string; perEpoch: bigint; tier: Tier; distribution: Distribution };
export type Rules = { minTokens: bigint; tier1: bigint; tier2: bigint; excluded?: Iterable<string> };

export type EligibleWallet = {
  stake: string;
  /** Where the rewards go: the wallet's address that holds the most 300 tokens. */
  address: string;
  tokens: bigint;
  /** ADA delegated to the pool, in lovelace; 0 when the wallet delegates elsewhere or not at all. */
  delegated: bigint;
  tier: Tier;
};

export type Allocation = { stake: string; address: string; unit: string; amount: bigint; tokens: bigint; tier: Tier };

// Base addresses whose payment and stake parts are both keys (addr1q…): people's
// wallets. Script addresses such as DEX liquidity pools hold 300 too, but are not
// holders in the sense of the drip.
const isKeyWallet = (address: string) => address.startsWith("addr1q");

export const tierOf = (delegated: bigint, rules: Pick<Rules, "tier1" | "tier2">): Tier =>
  delegated >= rules.tier2 ? 2 : delegated >= rules.tier1 ? 1 : 0;

/** Wallets (stake keys) that hold at least `minTokens` across their addresses, with their tier. */
export const eligibleWallets = (holders: Holder[], delegators: Delegator[], rules: Rules): EligibleWallet[] => {
  const delegated = new Map(delegators.map((delegator) => [delegator.stake_address, BigInt(delegator.amount)]));
  const excluded = new Set(rules.excluded ?? []);
  const wallets = new Map<string, { stake: string; address: string; tokens: bigint; bestQuantity: bigint }>();
  for (const holder of holders) {
    const stake = holder.stake_address;
    if (!stake || excluded.has(stake) || !isKeyWallet(holder.payment_address)) continue;
    const quantity = BigInt(holder.quantity);
    const wallet = wallets.get(stake) ?? { stake, address: holder.payment_address, tokens: 0n, bestQuantity: -1n };
    wallet.tokens += quantity;
    if (quantity > wallet.bestQuantity) {
      wallet.bestQuantity = quantity;
      wallet.address = holder.payment_address;
    }
    wallets.set(stake, wallet);
  }
  return [...wallets.values()]
    .filter((wallet) => wallet.tokens >= rules.minTokens)
    .map(({ stake, address, tokens }) => {
      const amount = delegated.get(stake) ?? 0n;
      return { stake, address, tokens, delegated: amount, tier: tierOf(amount, rules) };
    })
    .sort((a, b) => a.stake.localeCompare(b.stake));
};

const weightOf = (wallet: EligibleWallet, distribution: Distribution) =>
  distribution === "equal" ? 1n : distribution === "tokens" ? wallet.tokens : wallet.delegated;

/**
 * Splits each reward line's per-epoch budget between the wallets at or above
 * its tier. Amounts are rounded down, so no line ever exceeds its budget; the
 * remainder stays with the distributor. Lines of the same unit add up into one
 * allocation per wallet.
 */
export const allocate = (wallets: EligibleWallet[], rewards: Reward[]): Allocation[] => {
  const allocations = new Map<string, Allocation>();
  for (const reward of rewards) {
    if (reward.perEpoch <= 0n) continue;
    const members = wallets.filter((wallet) => wallet.tier >= reward.tier);
    const totalWeight = members.reduce((sum, wallet) => sum + weightOf(wallet, reward.distribution), 0n);
    if (totalWeight === 0n) continue;
    for (const wallet of members) {
      const amount = (reward.perEpoch * weightOf(wallet, reward.distribution)) / totalWeight;
      if (amount <= 0n) continue;
      const key = `${wallet.stake} ${reward.unit}`;
      const existing = allocations.get(key);
      if (existing) existing.amount += amount;
      else allocations.set(key, { stake: wallet.stake, address: wallet.address, unit: reward.unit, amount, tokens: wallet.tokens, tier: wallet.tier });
    }
  }
  return [...allocations.values()];
};

/** Wallets per tier, counting each wallet in every tier it reaches. */
export const tierCounts = (wallets: EligibleWallet[]) => ({
  holders: wallets.length,
  tier1: wallets.filter((wallet) => wallet.tier >= 1).length,
  tier2: wallets.filter((wallet) => wallet.tier >= 2).length,
});

/** Formats a base-unit amount with its decimals, e.g. 1500000 / 6 → "1.5". */
export const formatUnits = (amount: bigint, decimals: number) => {
  if (decimals === 0) return new Intl.NumberFormat("en-US").format(amount);
  const scale = 10n ** BigInt(decimals);
  const whole = new Intl.NumberFormat("en-US").format(amount / scale);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
};

/** Parses a human amount ("1.5") into base units; null if it has too many decimals or is not a number. */
export const parseUnits = (value: string, decimals: number): bigint | null => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim().replace(/,/g, ""));
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
};
