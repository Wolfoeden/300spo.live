// Drip eligibility and shares. Pure functions over Koios `asset_addresses`
// (holders of the 300 token) and `pool_delegators` (wallets staked with 300).

export type Holder = { payment_address: string; stake_address: string | null; quantity: string };
export type Delegator = { stake_address: string; amount: string };
export type Distribution = "equal" | "tokens" | "stake";
export type Reward = { unit: string; perEpoch: bigint };

export type EligibleWallet = {
  stake: string;
  /** Where the rewards go: the wallet's address that holds the most 300 tokens. */
  address: string;
  tokens: bigint;
  delegated: bigint;
};

export type Allocation = { stake: string; address: string; unit: string; amount: bigint; tokens: bigint };

/**
 * Wallets (stake keys) that are delegated to the pool and hold at least
 * `minTokens` across all their addresses.
 */
export const eligibleWallets = (holders: Holder[], delegators: Delegator[], minTokens: bigint): EligibleWallet[] => {
  const delegated = new Map(delegators.map((delegator) => [delegator.stake_address, BigInt(delegator.amount)]));
  const wallets = new Map<string, EligibleWallet & { bestQuantity: bigint }>();
  for (const holder of holders) {
    const stake = holder.stake_address;
    if (!stake || !delegated.has(stake) || !holder.payment_address.startsWith("addr1")) continue;
    const quantity = BigInt(holder.quantity);
    const wallet = wallets.get(stake) ?? { stake, address: holder.payment_address, tokens: 0n, delegated: delegated.get(stake)!, bestQuantity: -1n };
    wallet.tokens += quantity;
    if (quantity > wallet.bestQuantity) {
      wallet.bestQuantity = quantity;
      wallet.address = holder.payment_address;
    }
    wallets.set(stake, wallet);
  }
  return [...wallets.values()]
    .filter((wallet) => wallet.tokens >= minTokens)
    .map(({ stake, address, tokens, delegated: amount }) => ({ stake, address, tokens, delegated: amount }))
    .sort((a, b) => a.stake.localeCompare(b.stake));
};

const weightOf = (wallet: EligibleWallet, distribution: Distribution) =>
  distribution === "equal" ? 1n : distribution === "tokens" ? wallet.tokens : wallet.delegated;

/**
 * Splits each per-epoch budget by weight. Amounts are rounded down, so the
 * sum never exceeds the budget; the remainder stays with the distributor.
 */
export const allocate = (wallets: EligibleWallet[], rewards: Reward[], distribution: Distribution): Allocation[] => {
  const totalWeight = wallets.reduce((sum, wallet) => sum + weightOf(wallet, distribution), 0n);
  if (totalWeight === 0n) return [];
  const allocations: Allocation[] = [];
  for (const reward of rewards) {
    if (reward.perEpoch <= 0n) continue;
    for (const wallet of wallets) {
      const amount = (reward.perEpoch * weightOf(wallet, distribution)) / totalWeight;
      if (amount > 0n) allocations.push({ stake: wallet.stake, address: wallet.address, unit: reward.unit, amount, tokens: wallet.tokens });
    }
  }
  return allocations;
};

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
