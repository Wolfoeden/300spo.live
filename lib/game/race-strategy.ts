/** A standing pick for the horse race: one colour, or a band of the odds, chosen again on every deal. */
export type RaceStrategy = "blue" | "red" | "low" | "mid" | "high";

export const STRATEGIES: { id: RaceStrategy; label: string; key: string; name: string }[] = [
  { id: "blue", label: "Blue", key: "b", name: "Always the blue ace" },
  { id: "red", label: "Red", key: "r", name: "Always the red ace" },
  { id: "low", label: "Low", key: "l", name: "Always the lowest odds" },
  { id: "mid", label: "Mid", key: "m", name: "Always middle odds" },
  { id: "high", label: "High", key: "h", name: "Always the highest odds" },
];

/** The suit a colour strategy stands for: blue is spades, red is hearts. */
export const STRATEGY_SUIT: Partial<Record<RaceStrategy, number>> = { blue: 0, red: 1 };

/** The ace the strategy takes on a deal, or null when it has none that can win. */
export function strategyPick(strategy: RaceStrategy, odds: readonly number[] | null | undefined): number | null {
  if (!odds) return null;
  const suit = STRATEGY_SUIT[strategy];
  if (suit !== undefined) return (odds[suit] ?? 0) > 0 ? suit : null;
  const open = odds.map((value, index) => ({ value, index })).filter((entry) => entry.value > 0);
  if (!open.length) return null;
  open.sort((a, b) => a.value - b.value || a.index - b.index);
  if (strategy === "low") return open[0].index;
  if (strategy === "high") return open[open.length - 1].index;
  // Middle: not the favourite and not the outsider, the one nearest their geometric mean.
  const inner = open.length > 2 ? open.slice(1, -1) : open;
  const centre = Math.sqrt(open[0].value * open[open.length - 1].value);
  const distance = (value: number) => Math.abs(Math.log(value / centre));
  return inner.reduce((best, entry) => (distance(entry.value) < distance(best.value) ? entry : best)).index;
}
