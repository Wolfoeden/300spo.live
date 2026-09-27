export const DASH = "–";

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const formatCompact = (value: unknown, digits = 1) => {
  const number = toNumber(value);
  return number === null
    ? DASH
    : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: digits }).format(number);
};

export const formatInteger = (value: unknown) => {
  const number = toNumber(value);
  return number === null ? DASH : new Intl.NumberFormat("en-US").format(number);
};

/** Lovelace (number, string or bigint) as a compact ADA figure, e.g. "166.1K ADA". */
export const formatAdaCompact = (lovelace: unknown) => {
  const number = toNumber(typeof lovelace === "bigint" ? lovelace.toString() : lovelace);
  return number === null ? DASH : `${formatCompact(number / 1_000_000)} ADA`;
};

/** Exact ADA amount with up to two decimals, safe for large bigint balances. */
export const formatAdaExact = (lovelace: bigint) => {
  const whole = lovelace / 1_000_000n;
  const cents = (lovelace % 1_000_000n) / 10_000n;
  const wholeText = new Intl.NumberFormat("en-US").format(whole);
  return cents === 0n ? wholeText : `${wholeText}.${cents.toString().padStart(2, "0")}`;
};

export const formatTokenAmount = (quantity: bigint) => new Intl.NumberFormat("en-US").format(quantity);

export const formatPercent = (value: unknown) => {
  const number = toNumber(value);
  return number === null ? DASH : `${number.toFixed(number >= 10 ? 0 : 2)}%`;
};

/** Pool margin arrives as a fraction (0.01 = 1%). */
export const formatMargin = (value: unknown) => {
  const number = toNumber(value);
  return number === null ? DASH : formatPercent(number * 100);
};

export const capitalize = (value: unknown) =>
  typeof value === "string" && value ? value.charAt(0).toUpperCase() + value.slice(1) : DASH;
