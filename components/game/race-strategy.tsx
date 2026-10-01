"use client";

import { SUIT_COLORS, SUITS } from "@/lib/game/card-race";
import { STRATEGIES, STRATEGY_SUIT, type RaceStrategy } from "@/lib/game/race-strategy";
import { Kbd } from "./game-frame";

/**
 * Quick chips in the race terminal: a colour puts the chip on that ace's lane,
 * Low, Mid and High on the lane with those odds, on every race of the deal.
 * One row of seven on phones; on desktops the colours and the odds get a row each.
 */
export function StrategyPicker({ active, onPlace, disabled }: { active: readonly RaceStrategy[]; onPlace(strategy: RaceStrategy): void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-2 hidden items-center justify-between gap-2 text-xs text-faint lg:flex">
        Chip on every race
        <span className="flex gap-1">
          {STRATEGIES.map((entry) => (
            <Kbd key={entry.id}>{entry.key.toUpperCase()}</Kbd>
          ))}
        </span>
      </p>
      <div
        className="grid grid-cols-7 gap-0.5 rounded-xl border border-line bg-ink/60 p-0.5 lg:grid-cols-12 lg:gap-1 lg:rounded-2xl lg:p-1"
        role="group"
        aria-label="Place a chip by colour or odds"
      >
        {STRATEGIES.map((entry) => {
          const suit = STRATEGY_SUIT[entry.id];
          const on = active.includes(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => onPlace(entry.id)}
              disabled={disabled}
              aria-pressed={on}
              aria-keyshortcuts={entry.key.toUpperCase()}
              aria-label={suit === undefined ? entry.name : `${entry.label} (${SUITS[suit]})`}
              title={entry.name}
              className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-0.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 lg:gap-1.5 lg:rounded-xl lg:py-2.5 xl:text-sm ${
                suit === undefined ? "lg:col-span-4" : "lg:col-span-3"
              } ${on ? "bg-gold/20 text-gold-bright" : "text-muted enabled:hover:bg-white/5 enabled:hover:text-text"}`}
            >
              {suit !== undefined && (
                <span aria-hidden="true" className="size-3 shrink-0 rounded-full ring-1 ring-black/40 lg:size-3.5" style={{ backgroundColor: SUIT_COLORS[suit] }} />
              )}
              <span className={suit !== undefined ? "hidden truncate lg:inline" : "truncate"}>{entry.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
