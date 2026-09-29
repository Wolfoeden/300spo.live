"use client";

import { SUIT_COLORS, SUITS } from "@/lib/game/card-race";
import { STRATEGIES, STRATEGY_SUIT, type RaceStrategy } from "@/lib/game/race-strategy";
import { Kbd } from "./game-frame";

/**
 * Quick chips in the race terminal: a colour puts the chip on that ace's lane,
 * Low, Mid and High on the lane with those odds, on every race of the deal.
 */
export function StrategyPicker({ active, onPlace, disabled }: { active: readonly RaceStrategy[]; onPlace(strategy: RaceStrategy): void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-1.5 hidden items-center gap-1.5 text-[0.7rem] text-faint lg:flex">
        Chip on
        {STRATEGIES.map((entry) => (
          <Kbd key={entry.id}>{entry.key.toUpperCase()}</Kbd>
        ))}
      </p>
      <div className="grid grid-cols-7 gap-0.5 rounded-xl border border-line bg-ink/60 p-0.5" role="group" aria-label="Place a chip by colour or odds">
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
              className={`flex min-w-0 items-center justify-center gap-1 rounded-lg px-0.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 lg:py-2 ${
                on ? "bg-gold/20 text-gold-bright" : "text-muted enabled:hover:text-text"
              }`}
            >
              {suit !== undefined ? (
                <>
                  <span aria-hidden="true" className="size-3 shrink-0 rounded-full ring-1 ring-black/40" style={{ backgroundColor: SUIT_COLORS[suit] }} />
                  <span className="hidden xl:inline">{entry.label}</span>
                </>
              ) : (
                entry.label
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
